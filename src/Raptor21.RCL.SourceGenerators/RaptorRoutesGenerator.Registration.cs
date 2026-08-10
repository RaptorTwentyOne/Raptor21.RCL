using System.Collections.Immutable;
using System.Globalization;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Text;

namespace Raptor21.RCL.SourceGenerators;

/// <summary>
/// Phase B of the typed-routes design: reflection-free endpoint registration. The reflective scanner
/// (<c>RaptorPageEndpoints.MapRaptorPages</c>) discovers pages by assembly scan and then pays reflection on
/// EVERY request — <c>Activator.CreateInstance</c>, <c>MethodInfo.Invoke</c>, <c>TypeDescriptor</c> binding.
/// This partial emits <c>MapGeneratedRaptorPages()</c> instead: the same endpoints, but each handler gets a
/// typed invoker (direct construction, generated parameter binding, direct call) and its endpoint metadata
/// re-emitted statically.
///
/// PARITY IS THE CONTRACT. Binding reproduces the scanner's BindArguments bit for bit — RouteValues before
/// Query, silent default for a missing or unparseable non-nullable value, null for a nullable one, services
/// from DI with the declared-null-default fallback and the same throw message otherwise. Handlers with an
/// unsupported return shape are mapped and throw the scanner's own message at request time, not at startup.
/// The two registration paths must never be combined for one assembly: the routes would be mapped twice.
///
/// Attributes are re-emitted syntactically (constructor + named arguments) for the shapes attribute
/// arguments can take (primitives, enums, typeof, arrays, null). An attribute that cannot be re-emitted is
/// reported as RRG003 and SKIPPED — visible, not silent — because endpoint metadata is where authorization
/// lives.
/// </summary>
public sealed partial class RaptorRoutesGenerator
{
    private static readonly DiagnosticDescriptor SkippedMetadataAttribute = new(
        "RRG003",
        "Attribute not copied to generated endpoint metadata",
        "Attribute '{0}' could not be re-emitted by MapGeneratedRaptorPages and will be missing from endpoint metadata; simplify its arguments or keep the reflective MapRaptorPages for this assembly",
        "Raptor21.RCL",
        DiagnosticSeverity.Warning,
        isEnabledByDefault: true);

    private static (ImmutableArray<string> Metadata, ImmutableArray<string> Skipped, bool RequiresAuth) CollectMetadata(
        IEnumerable<AttributeData> attributes, string owner)
    {
        var metadata = ImmutableArray.CreateBuilder<string>();
        var skipped = ImmutableArray.CreateBuilder<string>();
        var requiresAuth = false;

        foreach (var attr in attributes)
        {
            var cls = attr.AttributeClass;
            if (cls is null || IsRouteInfrastructureAttribute(cls)) continue;

            if (cls.AllInterfaces.Any(i => i.ToDisplayString() == "Microsoft.AspNetCore.Authorization.IAuthorizeData"))
                requiresAuth = true;

            var expression = TryEmitAttribute(attr, cls);
            if (expression is null) skipped.Add($"{cls.Name} (on {owner})");
            else metadata.Add(expression);
        }

        return (metadata.ToImmutable(), skipped.ToImmutable(), requiresAuth);
    }

    /// <summary>The scanner skips exactly its own two attribute families when copying metadata.</summary>
    private static bool IsRouteInfrastructureAttribute(INamedTypeSymbol cls)
    {
        for (var current = cls; current is not null; current = current.BaseType)
        {
            var display = current.ToDisplayString();
            if (display is PageAttribute or HandlerAttributeBase) return true;
        }

        return false;
    }

    private static string? TryEmitAttribute(AttributeData attr, INamedTypeSymbol cls)
    {
        List<string?> args = [.. attr.ConstructorArguments.Select(EmitTypedConstant)];
        if (args.Contains(null)) return null;

        List<string?> named =
        [
            .. attr.NamedArguments.Select(argument =>
                EmitTypedConstant(argument.Value) is { } value ? $"{argument.Key} = {value}" : null)
        ];
        if (named.Contains(null)) return null;

        var ctor = $"new {GlobalTypeName(cls)}({string.Join(", ", args)})";
        return named.Count == 0 ? ctor : $"{ctor} {{ {string.Join(", ", named)} }}";
    }

    private static string? EmitTypedConstant(TypedConstant constant)
    {
        if (constant.IsNull) return "null";

        switch (constant.Kind)
        {
            case TypedConstantKind.Primitive:
                return constant.Value switch
                {
                    string s => SymbolDisplay.FormatLiteral(s, quote: true),
                    bool b => b ? "true" : "false",
                    char c => SymbolDisplay.FormatLiteral(c, quote: true),
                    float f => f.ToString("R", CultureInfo.InvariantCulture) + "f",
                    double d => d.ToString("R", CultureInfo.InvariantCulture) + "d",
                    byte or sbyte or short or ushort or int or uint or long or ulong =>
                        $"({constant.Type!.ToDisplayString()})({Convert.ToString(constant.Value, CultureInfo.InvariantCulture)})",
                    _ => null,
                };

            case TypedConstantKind.Enum:
                return constant.Type is null
                    ? null
                    : $"({GlobalTypeName(constant.Type)})({Convert.ToString(constant.Value, CultureInfo.InvariantCulture)})";

            case TypedConstantKind.Type:
                return constant.Value is ITypeSymbol t ? $"typeof({GlobalTypeName(t)})" : null;

            case TypedConstantKind.Array:
            {
                List<string?> items = [.. constant.Values.Select(EmitTypedConstant)];
                if (items.Contains(null) || constant.Type is not IArrayTypeSymbol array) return null;
                return $"new {GlobalTypeName(array.ElementType)}[] {{ {string.Join(", ", items)} }}";
            }

            default:
                return null;
        }
    }

    /// <summary>Fully-qualified spelling for emitted code: keyword types stay keywords, dotted names get
    /// <c>global::</c> so nothing in the consumer's namespaces can shadow them.</summary>
    private static string GlobalTypeName(ITypeSymbol type)
    {
        var display = type.ToDisplayString();
        return display.IndexOf('.') >= 0 ? "global::" + display : display;
    }

    // ---- Emission ------------------------------------------------------------------------------------------

    private static void EmitRegistration(SourceProductionContext spc, ImmutableArray<PageModel> models)
    {
        var pages = Deduplicate(models)
            .OrderBy(p => p.Namespace, StringComparer.Ordinal)
            .ThenBy(p => p.ClassName, StringComparer.Ordinal)
            .ToList();

        if (pages.Count == 0) return;

        foreach (var page in pages)
        {
            foreach (var skippedAttr in page.SkippedMetadata.Concat(page.Handlers.SelectMany(h => h.SkippedMetadata)))
                spc.ReportDiagnostic(Diagnostic.Create(SkippedMetadataAttribute, Location.None, skippedAttr));
        }

        var sb = new StringBuilder();
        sb.AppendLine("// <auto-generated by Raptor21.RCL.SourceGenerators — do not edit />");
        sb.AppendLine("#nullable enable");
        sb.AppendLine("// The binder intentionally passes possibly-null strings into non-nullable parameters — the");
        sb.AppendLine("// reflective scanner's exact semantics. See RaptorPageEndpoints.TryBindSimple.");
        sb.AppendLine("#pragma warning disable CS8600, CS8601, CS8602, CS8603, CS8604, CS8619, CS8625, CS8774");
        sb.AppendLine();
        sb.AppendLine("namespace Raptor21.RCL.Generated");
        sb.AppendLine("{");
        sb.AppendLine("    /// <summary>Reflection-free registration of this assembly's RaptorPage handlers. Call INSTEAD OF");
        sb.AppendLine("    /// <c>MapRaptorPages()</c> — never alongside it, or every route is mapped twice.</summary>");
        sb.AppendLine("    internal static class GeneratedRaptorPageEndpoints");
        sb.AppendLine("    {");
        sb.AppendLine("        private static readonly string[] VerbGet = { \"GET\" };");
        sb.AppendLine("        private static readonly string[] VerbPost = { \"POST\" };");
        sb.AppendLine();
        sb.AppendLine("        public static global::Microsoft.AspNetCore.Routing.IEndpointRouteBuilder MapGeneratedRaptorPages(");
        sb.AppendLine("            this global::Microsoft.AspNetCore.Routing.IEndpointRouteBuilder endpoints)");
        sb.AppendLine("        {");

        var endpointIndex = 0;
        for (var pi = 0; pi < pages.Count; pi++)
        {
            var page = pages[pi];
            for (var hi = 0; hi < page.Handlers.Length; hi++)
            {
                var handler = page.Handlers[hi];
                var invoker = $"Invoke_{pi}_{hi}_{handler.Name}";
                var verbs = handler.Verb == "GET" ? "VerbGet" : "VerbPost";

                var metadata = page.ClassMetadata.Concat(handler.MethodMetadata).ToList();
                if (page.ClassRequiresAuth || handler.MethodRequiresAuth)
                    metadata.Add("new global::Microsoft.AspNetCore.Authorization.AuthorizeAttribute()");

                foreach (var route in page.AllRoutes)
                {
                    var pattern = handler.Template.Length == 0 ? route : route + handler.Template;
                    var b = $"b{endpointIndex++}";

                    // The RequestDelegate overload, NOT the Delegate one: the latter routes through
                    // RequestDelegateFactory, which reflects over the delegate (and is [RequiresUnreferencedCode]).
                    // The invoker executes its IResult itself, so nothing here needs reflection — or RDF's latency.
                    sb.AppendLine($"            var {b} = global::Microsoft.AspNetCore.Builder.EndpointRouteBuilderExtensions.MapMethods(");
                    sb.AppendLine($"                endpoints, \"{pattern}\", {verbs},");
                    sb.AppendLine($"                new global::Microsoft.AspNetCore.Http.RequestDelegate({invoker}));");

                    if (metadata.Count > 0)
                    {
                        sb.AppendLine($"            global::Microsoft.AspNetCore.Builder.RoutingEndpointConventionBuilderExtensions.WithMetadata({b},");
                        sb.AppendLine($"                {string.Join(",\n                ", metadata)});");
                    }

                    sb.AppendLine();
                }
            }
        }

        sb.AppendLine("            return endpoints;");
        sb.AppendLine("        }");

        for (var pi = 0; pi < pages.Count; pi++)
        {
            var page = pages[pi];
            for (var hi = 0; hi < page.Handlers.Length; hi++)
                EmitInvoker(sb, page, page.Handlers[hi], $"Invoke_{pi}_{hi}_{page.Handlers[hi].Name}");
        }

        sb.AppendLine("    }");
        sb.AppendLine("}");
        spc.AddSource("Registration.g.cs", SourceText.From(sb.ToString(), Encoding.UTF8));
    }

    private static void EmitInvoker(StringBuilder sb, PageModel page, HandlerModel handler, string name)
    {
        sb.AppendLine();
        sb.AppendLine($"        /// <summary><c>{handler.Verb} {handler.Path}</c> → <c>{page.Namespace}.{page.ClassName}.{handler.Name}</c></summary>");

        if (handler.Return == ReturnKind.Unsupported)
        {
            // Mapped but throwing at request time — the scanner's own behaviour and message for a handler
            // whose return type it cannot unwrap.
            sb.AppendLine($"        private static global::System.Threading.Tasks.Task {name}(global::Microsoft.AspNetCore.Http.HttpContext ctx) =>");
            sb.AppendLine($"            throw new global::System.InvalidOperationException(\"RaptorPage handler '{page.ClassName}.{handler.Name}' must return IResult, Task<IResult> or ValueTask<IResult>.\");");
            return;
        }

        var isAsync = handler.Return != ReturnKind.Sync;

        sb.AppendLine($"        private static async global::System.Threading.Tasks.Task {name}(global::Microsoft.AspNetCore.Http.HttpContext ctx)");
        sb.AppendLine("        {");
        sb.AppendLine($"            var page = global::Raptor21.RCL.Pages.RaptorPageInvoker.Prepare(new {page.FullTypeName}(), ctx);");

        List<string> arguments = [];
        for (var i = 0; i < handler.InvokeParams.Length; i++)
        {
            var p = handler.InvokeParams[i];
            switch (p.Category)
            {
                case InvokeParamKind.Context:
                    arguments.Add("ctx");
                    break;
                case InvokeParamKind.Cancellation:
                    arguments.Add("ctx.RequestAborted");
                    break;
                case InvokeParamKind.Simple:
                    EmitSimpleBind(sb, i, p);
                    arguments.Add($"arg{i}");
                    break;
                default:
                    EmitServiceBind(sb, i, p);
                    arguments.Add($"arg{i}");
                    break;
            }
        }

        var call = $"page.{handler.Name}({string.Join(", ", arguments)})";
        var result = isAsync ? $"await {call}" : call;

        sb.AppendLine($"            var result = {result};");
        sb.AppendLine($"            if (result is null) throw new global::System.InvalidOperationException(\"RaptorPage handler '{page.ClassName}.{handler.Name}' returned null.\");");
        sb.AppendLine("            await result.ExecuteAsync(ctx);");
        sb.AppendLine("        }");
    }

    /// <summary>RouteValues first, then Query — then the scanner's exact conversion semantics per kind:
    /// missing/unparseable ⇒ default for a non-nullable parameter, null for a nullable one, never a 400.</summary>
    private static void EmitSimpleBind(StringBuilder sb, int i, InvokeParam p)
    {
        sb.AppendLine($"            string? raw{i} = ctx.Request.RouteValues.TryGetValue(\"{p.Name}\", out var rv{i}) ? rv{i}?.ToString() : null;");
        sb.AppendLine($"            if (string.IsNullOrEmpty(raw{i}) && ctx.Request.Query.TryGetValue(\"{p.Name}\", out var qv{i})) raw{i} = qv{i}.ToString();");

        if (p.Kind == SimpleKind.String)
        {
            sb.AppendLine($"            string? arg{i} = string.IsNullOrEmpty(raw{i}) ? null : raw{i};");
            return;
        }

        var bareType = p.TypeDisplay.EndsWith("?", StringComparison.Ordinal)
            ? p.TypeDisplay.Substring(0, p.TypeDisplay.Length - 1)
            : p.TypeDisplay;

        var tryParse = p.Kind switch
        {
            SimpleKind.Guid => "global::System.Guid.TryParse({0}, out {1})",
            SimpleKind.Int => "int.TryParse({0}, global::System.Globalization.NumberStyles.Integer, global::System.Globalization.CultureInfo.InvariantCulture, out {1})",
            SimpleKind.Long => "long.TryParse({0}, global::System.Globalization.NumberStyles.Integer, global::System.Globalization.CultureInfo.InvariantCulture, out {1})",
            SimpleKind.Decimal => "decimal.TryParse({0}, global::System.Globalization.NumberStyles.Number, global::System.Globalization.CultureInfo.InvariantCulture, out {1})",
            SimpleKind.Bool => "bool.TryParse({0}, out {1})",
            SimpleKind.DateTime => "global::System.DateTime.TryParse({0}, global::System.Globalization.CultureInfo.InvariantCulture, global::System.Globalization.DateTimeStyles.None, out {1})",
            _ => $"global::System.Enum.TryParse<{bareType}>({{0}}, out {{1}})",
        };

        if (p.IsNullable)
        {
            sb.AppendLine($"            {bareType}? arg{i} = null;");
            sb.AppendLine($"            if (!string.IsNullOrEmpty(raw{i}) && {string.Format(tryParse, $"raw{i}", $"var tmp{i}")}) arg{i} = tmp{i};");
        }
        else
        {
            sb.AppendLine($"            var arg{i} = default({bareType});");
            sb.AppendLine($"            if (!string.IsNullOrEmpty(raw{i})) {string.Format(tryParse, $"raw{i}", $"arg{i}")};");
        }
    }

    private static void EmitServiceBind(StringBuilder sb, int i, InvokeParam p)
    {
        var typeForMessage = p.TypeDisplay.StartsWith("global::", StringComparison.Ordinal)
            ? p.TypeDisplay.Substring("global::".Length)
            : p.TypeDisplay;

        sb.AppendLine($"            object? svc{i} = ctx.RequestServices.GetService(typeof({p.TypeDisplay}));");

        var fallback = p.AllowNullService
            ? "default!"
            : $"throw new global::System.InvalidOperationException(\"Cannot bind handler parameter '{p.Name}' of type {typeForMessage}.\")";

        sb.AppendLine($"            {p.TypeDisplay} arg{i} = svc{i} is {p.TypeDisplay} cast{i} ? cast{i} : {fallback};");
    }
}
