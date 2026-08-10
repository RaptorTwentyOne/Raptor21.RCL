using System.Collections.Immutable;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Text;

namespace Raptor21.RCL.SourceGenerators;

/// <summary>
/// Emits <c>Routes</c> — one nested static class per <c>[RaptorPage]</c>/<c>[RaptorComponent]</c> class in
/// the consuming compilation, whose members are that page's handler URLs. What used to be
/// <c>hx-post="@($"/modals/page-group/edit?pageGroupId={id}")"</c> becomes
/// <c>hx-post="@Routes.PageGroupModal.Edit(id, vkorgId)"</c>: the route string exists in exactly one place
/// (the attribute), every reference is compiler-checked, and renaming a route breaks the build instead of a dialog.
///
/// The class is deliberately NOT named "RaptorRoutes": it lives in HOST code, and a host should not have to
/// spell a library brand in its own markup. The name is overridable per project via the compiler-visible
/// <c>RaptorRoutesClassName</c> MSBuild property (see buildTransitive/Raptor21.RCL.props) for the host that
/// already owns a type called <c>Routes</c>.
///
/// Contract with the runtime — kept bit-for-bit with <c>RaptorPageEndpoints</c>:
///   * Path normalisation is the scanner's own: base = "/" + route.Trim('/'); handler = base + "/" + template.Trim('/').
///   * A handler's simple parameters (string/Guid/int/long/bool/decimal/DateTime/enum + nullables) are what
///     <c>TryBindSimple</c> reads from route values then query — so the generated builder fills route tokens by
///     parameter NAME and appends everything else as query-string pairs under the same names.
///   * HttpContext / CancellationToken / DI-resolved parameters never appear in a URL, so they are skipped.
///
/// Emission rules:
///   * <c>Base</c> const — the primary route (aliases are reachable at runtime but URLs should target the primary).
///   * Handler with no URL-relevant parameters → <c>public const string Name</c>.
///   * Handler with parameters → <c>public static string Name(...)</c>; route-token parameters first (path order,
///     required), the rest in declaration order; nullable ones become optional and are omitted from the query when
///     null. Values are invariant-formatted (enum → its numeric value, DateTime → round-trip "O").
///   * A route token with no matching parameter stays literal (<c>{key}</c>) — that is the client-side-template
///     escape hatch (grid <c>DetailUrl</c>).
///
/// Known limits (deliberate, documented): handlers declared inside a .razor <c>@code</c> block are invisible to
/// this generator (it sees only the C# compilation's own syntax, and the Razor generator's output is not an input);
/// keep handlers in the .razor.cs partial, which is already the codebase convention. Attribute subclasses beyond
/// RaptorPage/RaptorComponent are not discovered (ForAttributeWithMetadataName matches exact names).
/// </summary>
[Generator]
public sealed class RaptorRoutesGenerator : IIncrementalGenerator
{
    private const string PageAttribute = "Raptor21.RCL.Pages.RaptorPageAttribute";
    private const string ComponentAttribute = "Raptor21.RCL.Pages.RaptorComponentAttribute";
    private const string HandlerAttributeBase = "Raptor21.RCL.Pages.HtmxHandlerAttribute";

    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        var pages = Collect(context, PageAttribute);
        var components = Collect(context, ComponentAttribute);

        var routesName = context.AnalyzerConfigOptionsProvider.Select(static (provider, _) =>
            provider.GlobalOptions.TryGetValue("build_property.RaptorRoutesClassName", out var configured) &&
            IsValidIdentifier(configured)
                ? configured
                : "Routes");

        var all = pages.Collect().Combine(components.Collect()).Combine(routesName);

        context.RegisterSourceOutput(all, static (spc, pair) =>
        {
            var models = pair.Left.Left.AddRange(pair.Left.Right);
            if (models.Length == 0) return;
            spc.AddSource("Routes.g.cs", SourceText.From(Emit(models, pair.Right), Encoding.UTF8));
        });
    }

    private static bool IsValidIdentifier(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        if (!char.IsLetter(value[0]) && value[0] != '_') return false;
        foreach (var c in value)
        {
            if (!char.IsLetterOrDigit(c) && c != '_') return false;
        }

        return true;
    }

    private static IncrementalValuesProvider<PageModel> Collect(
        IncrementalGeneratorInitializationContext context, string attributeName) =>
        context.SyntaxProvider.ForAttributeWithMetadataName(
                attributeName,
                static (node, _) => true,
                static (ctx, _) => Extract(ctx))
            .Where(static m => m is not null)
            .Select(static (m, _) => m!);

    private static PageModel? Extract(GeneratorAttributeSyntaxContext ctx)
    {
        if (ctx.TargetSymbol is not INamedTypeSymbol type) return null;

        var attr = ctx.Attributes[0];
        if (attr.ConstructorArguments.Length == 0 ||
            attr.ConstructorArguments[0].Value is not string primaryRoute ||
            string.IsNullOrWhiteSpace(primaryRoute))
            return null;

        var basePath = "/" + primaryRoute.Trim('/');
        var handlers = ImmutableArray.CreateBuilder<HandlerModel>();

        foreach (var member in type.GetMembers())
        {
            if (member is not IMethodSymbol
                {
                    MethodKind: MethodKind.Ordinary,
                    DeclaredAccessibility: Accessibility.Public,
                    IsStatic: false
                } method) continue;

            var handlerAttr = FindHandlerAttribute(method);
            if (handlerAttr is null) continue;

            var template = handlerAttr.ConstructorArguments.Length > 0
                ? handlerAttr.ConstructorArguments[0].Value as string
                : null;

            var sub = string.IsNullOrWhiteSpace(template) ? "" : "/" + template!.Trim('/');
            var path = sub.Length == 0 ? basePath : basePath + sub;

            var verb = handlerAttr.AttributeClass!.Name switch
            {
                "HtmxGetAttribute" => "GET",
                "HtmxPostAttribute" => "POST",
                _ => "POST",
            };

            handlers.Add(new HandlerModel(method.Name, verb, path, ExtractParams(method, path)));
        }

        if (handlers.Count == 0) return null;

        return new PageModel(
            type.Name,
            type.ContainingNamespace.IsGlobalNamespace ? "" : type.ContainingNamespace.ToDisplayString(),
            basePath,
            handlers.ToImmutable());
    }

    private static AttributeData? FindHandlerAttribute(IMethodSymbol method)
    {
        foreach (var attr in method.GetAttributes())
        {
            for (var cls = attr.AttributeClass; cls is not null; cls = cls.BaseType)
            {
                if (cls.ToDisplayString() == HandlerAttributeBase) return attr;
            }
        }

        return null;
    }

    private static ImmutableArray<ParamModel> ExtractParams(IMethodSymbol method, string path)
    {
        var tokens = RouteTokens(path);
        var builder = ImmutableArray.CreateBuilder<ParamModel>();

        // Route tokens first, in PATH order — they are the method's required leading parameters. A token the
        // handler also declares takes the handler's type; one it does not declare (the handler may simply not
        // need the value the route carries) still HAS to be in the URL, so it becomes a synthetic required
        // parameter typed from its route constraint. Only the Base const keeps the literal template — that is
        // the client-side-template escape hatch (grid DetailUrl).
        var consumed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var token in tokens)
        {
            var match = method.Parameters.FirstOrDefault(p =>
                string.Equals(p.Name, token.Name, StringComparison.OrdinalIgnoreCase));

            if (match is not null && ClassifyParameter(match) is { } classified)
            {
                consumed.Add(match.Name);
                builder.Add(new ParamModel(match.Name, classified.Kind, false, true, classified.SignatureNonNull));
            }
            else
            {
                var kind = token.Constraint switch
                {
                    "guid" => SimpleKind.Guid,
                    "int" => SimpleKind.Int,
                    "long" => SimpleKind.Long,
                    "bool" => SimpleKind.Bool,
                    "decimal" => SimpleKind.Decimal,
                    "datetime" => SimpleKind.DateTime,
                    _ => SimpleKind.String,
                };

                builder.Add(new ParamModel(token.Name, kind, false, true, SignatureTypeForKind(kind, null, false)));
            }
        }

        foreach (var p in method.Parameters)
        {
            if (consumed.Contains(p.Name)) continue;
            if (ClassifyParameter(p) is not { } classified) continue;

            builder.Add(new ParamModel(p.Name, classified.Kind, classified.IsNullable, false, classified.Signature));
        }

        return builder.ToImmutable();
    }

    private readonly record struct ClassifiedParam(SimpleKind Kind, bool IsNullable, string Signature, string SignatureNonNull);

    private static ClassifiedParam? ClassifyParameter(IParameterSymbol p)
    {
        var display = p.Type.ToDisplayString();
        if (display is "Microsoft.AspNetCore.Http.HttpContext" or "System.Threading.CancellationToken") return null;

        var underlying = p.Type;
        var isNullableValue = false;

        if (underlying is INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T } nullable)
        {
            underlying = nullable.TypeArguments[0];
            isNullableValue = true;
        }

        var kind = Classify(underlying);
        if (kind is null) return null; // DI-resolved service parameter: never part of the URL.

        var isNullable = isNullableValue || kind == SimpleKind.String;

        return new ClassifiedParam(
            kind.Value,
            isNullable,
            SignatureTypeForKind(kind.Value, underlying, isNullable),
            SignatureTypeForKind(kind.Value, underlying, false));
    }

    private static SimpleKind? Classify(ITypeSymbol type)
    {
        if (type.TypeKind == TypeKind.Enum) return SimpleKind.Enum;

        return type.SpecialType switch
        {
            SpecialType.System_String => SimpleKind.String,
            SpecialType.System_Int32 => SimpleKind.Int,
            SpecialType.System_Int64 => SimpleKind.Long,
            SpecialType.System_Boolean => SimpleKind.Bool,
            SpecialType.System_Decimal => SimpleKind.Decimal,
            SpecialType.System_DateTime => SimpleKind.DateTime,
            _ => type is INamedTypeSymbol { Name: "Guid", ContainingNamespace.Name: "System" }
                ? SimpleKind.Guid
                : null,
        };
    }

    private static string SignatureTypeForKind(SimpleKind kind, ITypeSymbol? underlying, bool isNullable)
    {
        var core = kind switch
        {
            SimpleKind.String => "string",
            SimpleKind.Int => "int",
            SimpleKind.Long => "long",
            SimpleKind.Bool => "bool",
            SimpleKind.Decimal => "decimal",
            SimpleKind.DateTime => "global::System.DateTime",
            SimpleKind.Guid => "global::System.Guid",
            _ => underlying is null ? "string" : "global::" + underlying.ToDisplayString(),
        };

        return isNullable ? core + "?" : core;
    }

    private readonly record struct RouteToken(string Name, string Constraint);

    /// <summary>The path's <c>{name}</c>/<c>{name:constraint}</c> tokens, in path order.</summary>
    private static List<RouteToken> RouteTokens(string path)
    {
        var tokens = new List<RouteToken>();
        foreach (Match match in Regex.Matches(path, @"\{([^}:?]+)(?::([^}?]+))?\}"))
            tokens.Add(new RouteToken(match.Groups[1].Value, match.Groups[2].Value.ToLowerInvariant()));
        return tokens;
    }

    // ---- Emission ------------------------------------------------------------------------------------------

    private static string Emit(ImmutableArray<PageModel> models, string routesName)
    {
        var sb = new StringBuilder();
        sb.AppendLine("// <auto-generated by Raptor21.RCL.SourceGenerators — do not edit />");
        sb.AppendLine("#nullable enable");
        sb.AppendLine("global using Raptor21.RCL.Generated;");
        sb.AppendLine();
        sb.AppendLine("namespace Raptor21.RCL.Generated");
        sb.AppendLine("{");
        sb.AppendLine("    /// <summary>Compile-time route accessors for the [RaptorPage]/[RaptorComponent] classes of this");
        sb.AppendLine("    /// assembly. Generated by Raptor21.RCL; the single source of truth stays the attributes.</summary>");
        sb.AppendLine($"    internal static class {routesName}");
        sb.AppendLine("    {");

        // Pre-seeding the outer name keeps a page class that happens to share it from emitting a nested
        // class with its enclosing class's name, which C# forbids.
        var emitted = new HashSet<string>(StringComparer.Ordinal) { routesName };

        foreach (var model in Deduplicate(models))
        {
            var className = ClassName(model, emitted);
            emitted.Add(className);

            sb.AppendLine($"        /// <summary>Routes of <c>{model.Namespace}.{model.ClassName}</c> (\"{model.PrimaryRoute}\").</summary>");
            sb.AppendLine($"        public static class {className}");
            sb.AppendLine("        {");
            sb.AppendLine($"            /// <summary>The component's base route.</summary>");
            sb.AppendLine($"            public const string Base = \"{model.PrimaryRoute}\";");

            var memberNames = new HashSet<string>(StringComparer.Ordinal) { "Base", className };

            foreach (var handler in model.Handlers)
                EmitHandler(sb, handler, memberNames);

            sb.AppendLine("        }");
            sb.AppendLine();
        }

        sb.AppendLine("    }");
        sb.AppendLine("}");
        return sb.ToString();
    }

    /// <summary>Partial-class declarations can surface the same page once per attributed declaration.</summary>
    private static IEnumerable<PageModel> Deduplicate(ImmutableArray<PageModel> models)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var model in models)
        {
            if (seen.Add(model.Namespace + "." + model.ClassName)) yield return model;
        }
    }

    private static string ClassName(PageModel model, HashSet<string> emitted)
    {
        if (!emitted.Contains(model.ClassName)) return model.ClassName;

        // Same class name in two namespaces: qualify with the namespace's last segment.
        var lastDot = model.Namespace.LastIndexOf('.');
        var segment = lastDot >= 0 ? model.Namespace.Substring(lastDot + 1) : model.Namespace;
        var candidate = segment + model.ClassName;
        var i = 2;
        while (emitted.Contains(candidate)) candidate = segment + model.ClassName + i++;
        return candidate;
    }

    private static void EmitHandler(StringBuilder sb, HandlerModel handler, HashSet<string> memberNames)
    {
        var name = handler.Name;
        if (!memberNames.Add(name))
        {
            name = handler.Name + (handler.Verb == "GET" ? "Get" : "Post");
            if (!memberNames.Add(name)) return; // two same-name same-verb handlers: first wins, scanner would clash too
        }

        var urlParams = handler.Params.Where(p => !p.IsToken).ToList();
        var tokenParams = handler.Params.Where(p => p.IsToken).ToList();

        sb.AppendLine();
        sb.AppendLine($"            /// <summary><c>{handler.Verb} {handler.Path}</c> — <c>{handler.Name}</c> handler.</summary>");

        if (handler.Params.Length == 0)
        {
            sb.AppendLine($"            public const string {name} = \"{handler.Path}\";");
            return;
        }

        // Route tokens first (path order is what the signature promises), then query params in declaration
        // order. Optionality: C# only allows trailing optionals, so defaults start at the last run of nullables.
        var ordered = tokenParams.Concat(urlParams).ToList();
        var firstOptional = ordered.Count;
        for (var i = ordered.Count - 1; i >= 0 && ordered[i].IsNullable && !ordered[i].IsToken; i--) firstOptional = i;

        var signature = string.Join(", ", ordered.Select((p, i) =>
            $"{p.SignatureType} {p.Name}{(i >= firstOptional ? " = null" : "")}"));

        sb.AppendLine($"            public static string {name}({signature})");
        sb.AppendLine("            {");
        sb.AppendLine($"                var sb = new global::System.Text.StringBuilder({PathExpression(handler.Path, tokenParams)});");

        if (urlParams.Count > 0)
        {
            sb.AppendLine("                var sep = '?';");
            foreach (var p in urlParams)
            {
                if (p.IsNullable)
                {
                    sb.AppendLine($"                if ({p.Name} is {{ }} {p.Name}Value)");
                    sb.AppendLine("                {");
                    sb.AppendLine($"                    sb.Append(sep).Append(\"{p.Name}=\").Append({ValueExpression(p.Kind, p.Name + "Value")});");
                    sb.AppendLine("                    sep = '&';");
                    sb.AppendLine("                }");
                }
                else
                {
                    sb.AppendLine($"                sb.Append(sep).Append(\"{p.Name}=\").Append({ValueExpression(p.Kind, p.Name)});");
                    sb.AppendLine("                sep = '&';");
                }
            }
        }

        sb.AppendLine("                return sb.ToString();");
        sb.AppendLine("            }");
    }

    /// <summary>The path with matched <c>{token}</c> segments replaced by parameter values; unmatched tokens stay
    /// literal for client-side templates.</summary>
    private static string PathExpression(string path, List<ParamModel> tokenParams)
    {
        if (tokenParams.Count == 0) return $"\"{path}\"";

        var expression = new StringBuilder();
        var remaining = path;

        foreach (Match match in Regex.Matches(path, @"\{([^}:?]+)[^}]*\}"))
        {
            var param = tokenParams.Find(p => string.Equals(p.Name, match.Groups[1].Value, StringComparison.OrdinalIgnoreCase));
            if (param is null) continue;

            var index = remaining.IndexOf(match.Value, StringComparison.Ordinal);
            if (index < 0) continue;

            if (expression.Length > 0) expression.Append(" + ");
            expression.Append($"\"{remaining.Substring(0, index)}\" + {EscapedValueExpression(param.Kind, param.Name)}");
            remaining = remaining.Substring(index + match.Value.Length);
        }

        if (expression.Length == 0) return $"\"{path}\"";
        if (remaining.Length > 0) expression.Append($" + \"{remaining}\"");
        return expression.ToString();
    }

    /// <summary>Invariant wire format per kind — the exact strings <c>TryBindSimple</c> parses back.</summary>
    private static string ValueExpression(SimpleKind kind, string name) => kind switch
    {
        SimpleKind.String => $"global::System.Uri.EscapeDataString({name})",
        SimpleKind.Guid => $"{name}.ToString(\"D\")",
        SimpleKind.Int or SimpleKind.Long or SimpleKind.Decimal =>
            $"{name}.ToString(global::System.Globalization.CultureInfo.InvariantCulture)",
        SimpleKind.Bool => $"({name} ? \"true\" : \"false\")",
        SimpleKind.DateTime =>
            $"global::System.Uri.EscapeDataString({name}.ToString(\"O\", global::System.Globalization.CultureInfo.InvariantCulture))",
        _ => $"{name}.ToString(\"D\")", // enum: numeric value, what the existing hx-vals payloads already send
    };

    private static string EscapedValueExpression(SimpleKind kind, string name) => kind switch
    {
        SimpleKind.String => $"global::System.Uri.EscapeDataString({name})",
        _ => ValueExpression(kind, name),
    };

    private sealed record PageModel(
        string ClassName,
        string Namespace,
        string PrimaryRoute,
        ImmutableArray<HandlerModel> Handlers);

    private sealed record HandlerModel(string Name, string Verb, string Path, ImmutableArray<ParamModel> Params);

    private sealed record ParamModel(string Name, SimpleKind Kind, bool IsNullable, bool IsToken, string SignatureType);

    private enum SimpleKind
    {
        String,
        Guid,
        Int,
        Long,
        Bool,
        Decimal,
        DateTime,
        Enum,
    }
}
