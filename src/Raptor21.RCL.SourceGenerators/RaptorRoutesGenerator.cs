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
public sealed partial class RaptorRoutesGenerator : IIncrementalGenerator
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

        // RFC 0001 Part 2(b), generator half: data-rg-modal-link="<id>" opener declarations in .razor markup
        // (fed in as AdditionalFiles by buildTransitive/Raptor21.RCL.props) each become an accessor class —
        // <Id>.Url / .Id / .Query — so the deep link the client half answers is also never hand-written.
        var modalLinks = context.AdditionalTextsProvider
            .Where(static file => file.Path.EndsWith(".razor", StringComparison.OrdinalIgnoreCase))
            .Select(static (file, ct) =>
            {
                var markup = file.GetText(ct)?.ToString() ?? string.Empty;
                // CreateRange, not a collection expression: the ImmutableArray shipped for netstandard2.0
                // predates collection-builder support (CS9210).
                return new MarkupFileModel(
                    Path.GetFileNameWithoutExtension(file.Path),
                    ImmutableArray.CreateRange(MarkupScan.ModalLinkIds(markup)),
                    ImmutableArray.CreateRange(MarkupScan.RaptorModalIds(markup)));
            })
            .Where(static m => m.Ids.Length > 0 || m.ModalIds.Length > 0);

        var linkInputs = modalLinks.Collect().Combine(pages.Collect().Combine(components.Collect()));

        context.RegisterSourceOutput(linkInputs, static (spc, pair) =>
            EmitModalLinks(spc, pair.Left, pair.Right.Left.AddRange(pair.Right.Right)));

        // Phase B: reflection-free endpoint registration. One generated MapGeneratedRaptorPages() replaces
        // the reflective scanner for this compilation — typed invokers, generated parameter binding with the
        // scanner's exact silent-default semantics, statically re-emitted endpoint metadata. See the
        // Registration partial.
        var registrationInputs = pages.Collect().Combine(components.Collect());

        context.RegisterSourceOutput(registrationInputs, static (spc, pair) =>
            EmitRegistration(spc, pair.Left.AddRange(pair.Right)));
    }

    private static readonly DiagnosticDescriptor DuplicateLinkId = new(
        "RRG001",
        "Duplicate modal link id",
        "data-rg-modal-link id '{0}' is declared in more than one place; only the first declaration generates an accessor",
        "Raptor21.RCL",
        DiagnosticSeverity.Warning,
        isEnabledByDefault: true);

    private static readonly DiagnosticDescriptor UnusableLinkId = new(
        "RRG002",
        "Modal link id cannot form a class name",
        "data-rg-modal-link id '{0}' cannot be converted to a C# identifier; use letters/digits with '-', '_', '.' or ' ' separators, starting with a letter",
        "Raptor21.RCL",
        DiagnosticSeverity.Warning,
        isEnabledByDefault: true);

    private static readonly DiagnosticDescriptor ModalIdInUnroutedComponent = new(
        "RRG004",
        "RaptorModal Id in an unrouted component",
        "RaptorModal Id '{0}' is declared in '{1}.razor', whose class carries no [RaptorPage]/[RaptorComponent] route — there is no endpoint to alias, so no accessor is generated",
        "Raptor21.RCL",
        DiagnosticSeverity.Warning,
        isEnabledByDefault: true);

    private static void EmitModalLinks(
        SourceProductionContext spc, ImmutableArray<MarkupFileModel> files, ImmutableArray<PageModel> pages)
    {
        if (files.Length == 0) return;

        // A file's markup pairs with its routed class by name (UsersPage.razor ↔ UsersPage) — that is what
        // makes a full Url emittable. An opener declared in an UNROUTED component (a grid, a panel) still
        // gets Id + Query; the host composes them with the hosting page's own Routes entry.
        var pageByClass = Deduplicate(pages)
            .GroupBy(page => page.ClassName, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

        var sb = new StringBuilder();
        sb.AppendLine("// <auto-generated by Raptor21.RCL.SourceGenerators — do not edit />");
        sb.AppendLine("#nullable enable");
        // Routes.g.cs already emits this global using whenever any routed class exists; emitting it twice
        // would raise CS8933 in every consumer.
        if (pages.Length == 0) sb.AppendLine("global using Raptor21.RCL.Generated;");
        sb.AppendLine();
        sb.AppendLine("namespace Raptor21.RCL.Generated");
        sb.AppendLine("{");

        var seenIds = new HashSet<string>(StringComparer.Ordinal);
        var emittedNames = new HashSet<string>(StringComparer.Ordinal);

        foreach (var file in files.OrderBy(f => f.FileClass, StringComparer.Ordinal))
        {
            foreach (var id in file.Ids)
            {
                if (!seenIds.Add(id))
                {
                    spc.ReportDiagnostic(Diagnostic.Create(DuplicateLinkId, Location.None, id));
                    continue;
                }

                var className = MarkupScan.PascalIdentifier(id);
                if (className is null)
                {
                    spc.ReportDiagnostic(Diagnostic.Create(UnusableLinkId, Location.None, id));
                    continue;
                }

                if (!emittedNames.Add(className))
                {
                    spc.ReportDiagnostic(Diagnostic.Create(DuplicateLinkId, Location.None, id));
                    continue;
                }

                pageByClass.TryGetValue(file.FileClass, out var page);
                EmitModalLink(sb, id, className, page);
            }

            // RaptorModal Id="…" declarations: alias semantics (RFC 0001 (c)) — in this architecture a modal
            // IS a routed component, so the instance's URL is that component's own GET endpoint.
            foreach (var id in file.ModalIds)
            {
                if (!seenIds.Add(id))
                {
                    spc.ReportDiagnostic(Diagnostic.Create(DuplicateLinkId, Location.None, id));
                    continue;
                }

                var className = MarkupScan.PascalIdentifier(id);
                if (className is null)
                {
                    spc.ReportDiagnostic(Diagnostic.Create(UnusableLinkId, Location.None, id));
                    continue;
                }

                if (!emittedNames.Add(className))
                {
                    spc.ReportDiagnostic(Diagnostic.Create(DuplicateLinkId, Location.None, id));
                    continue;
                }

                if (!pageByClass.TryGetValue(file.FileClass, out var page))
                {
                    spc.ReportDiagnostic(Diagnostic.Create(ModalIdInUnroutedComponent, Location.None, id, file.FileClass));
                    continue;
                }

                EmitModalAlias(sb, id, className, page);
            }
        }

        sb.AppendLine("}");
        spc.AddSource("ModalLinks.g.cs", SourceText.From(sb.ToString(), Encoding.UTF8));
    }

    private static void EmitModalLink(StringBuilder sb, string id, string className, PageModel? page)
    {
        sb.AppendLine($"    /// <summary>Deep-link accessors for the opener declaring <c>data-rg-modal-link=\"{id}\"</c>.");
        sb.AppendLine("    /// The client clicks that opener when a page loads with <see cref=\"Query\"/> in its URL.</summary>");
        sb.AppendLine($"    internal static class {className}");
        sb.AppendLine("    {");
        sb.AppendLine("        /// <summary>The wire id — the value the opener's <c>data-rg-modal-link</c> attribute carries.</summary>");
        sb.AppendLine($"        public const string Id = \"{id}\";");
        sb.AppendLine();
        sb.AppendLine("        /// <summary>Append to any page URL that renders the opener.</summary>");
        sb.AppendLine($"        public const string Query = \"?modal={id}\";");

        if (page is not null)
        {
            var tokens = RouteTokens(page.PrimaryRoute);

            sb.AppendLine();
            sb.AppendLine($"        /// <summary>The deep link: <c>{page.PrimaryRoute}{"?modal=" + id}</c> — the declaring");
            sb.AppendLine($"        /// component's own page route (<c>{page.Namespace}.{page.ClassName}</c>) plus <see cref=\"Query\"/>.</summary>");

            if (tokens.Count == 0)
            {
                sb.AppendLine($"        public const string Url = \"{page.PrimaryRoute}?modal={id}\";");
            }
            else
            {
                List<ParamModel> tokenParams =
                [
                    .. tokens.Select(t =>
                    {
                        var kind = KindFromConstraint(t.Constraint);
                        return new ParamModel(t.Name, kind, false, true, SignatureTypeForKind(kind, null, false));
                    })
                ];

                var signature = string.Join(", ", tokenParams.Select(p => $"{p.SignatureType} {p.Name}"));
                sb.AppendLine($"        public static string Url({signature}) =>");
                sb.AppendLine($"            {PathExpression(page.PrimaryRoute, tokenParams)} + Query;");
            }
        }

        sb.AppendLine("    }");
        sb.AppendLine();
    }

    /// <summary>The alias accessor for one <c>&lt;RaptorModal Id="…"&gt;</c>: the wire id, the declaring
    /// component's base route, and — when the component has a GET on its base route (the "open" endpoint by
    /// this codebase's convention) — a <c>Url</c> member mirroring it, parameters included.</summary>
    private static void EmitModalAlias(StringBuilder sb, string id, string className, PageModel page)
    {
        sb.AppendLine($"    /// <summary>Accessors for <c>&lt;RaptorModal Id=\"{id}\"&gt;</c> — an alias over its declaring routed");
        sb.AppendLine($"    /// component <c>{page.Namespace}.{page.ClassName}</c> (\"{page.PrimaryRoute}\").</summary>");
        sb.AppendLine($"    internal static class {className}");
        sb.AppendLine("    {");
        sb.AppendLine("        /// <summary>The wire id — rendered as <c>data-rg-modal-id</c> on the dialog element.</summary>");
        sb.AppendLine($"        public const string Id = \"{id}\";");
        sb.AppendLine();
        sb.AppendLine("        /// <summary>The declaring component's base route.</summary>");
        sb.AppendLine($"        public const string Base = \"{page.PrimaryRoute}\";");

        var open = page.Handlers.FirstOrDefault(h => h.Verb == "GET" && h.Template.Length == 0);
        if (open is not null)
        {
            sb.AppendLine();
            EmitEndpointMember(sb, "Url", open, "        ");
        }

        sb.AppendLine("    }");
        sb.AppendLine();
    }

    private sealed record MarkupFileModel(
        string FileClass, ImmutableArray<string> Ids, ImmutableArray<string> ModalIds);

    private static bool IsValidIdentifier(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        if (!char.IsLetter(value[0]) && value[0] != '_') return false;
        return value.All(c => char.IsLetterOrDigit(c) || c == '_');
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

        // No constructor arguments = the convention route (RFC 0001 Part 1), derived from the class name by
        // the same rule the runtime scanner applies — see RouteConvention's parity contract.
        string primaryRoute;
        if (attr.ConstructorArguments.Length == 0)
            primaryRoute = RouteConvention.RouteFor(type.Name);
        else if (attr.ConstructorArguments[0].Value is string explicitRoute && !string.IsNullOrWhiteSpace(explicitRoute))
            primaryRoute = explicitRoute;
        else
            return null;

        var basePath = "/" + primaryRoute.Trim('/');

        // Alias routes (the attribute's params array): each handler is registered under every one, exactly
        // as the reflective scanner does. Routes.g.cs keeps pointing URLs at the primary alone.
        var allRoutes = ImmutableArray.CreateBuilder<string>();
        allRoutes.Add(basePath);
        if (attr.ConstructorArguments.Length > 1 && attr.ConstructorArguments[1].Kind == TypedConstantKind.Array)
        {
            // The trailing Where reads allRoutes WHILE the loop appends — deliberate: streaming evaluation
            // keeps the duplicate check current for repeated aliases within the same array.
            var aliases = attr.ConstructorArguments[1].Values
                .Select(alias => alias.Value as string)
                .Where(alias => !string.IsNullOrWhiteSpace(alias))
                .Select(alias => "/" + alias!.Trim('/'));

            foreach (var normalized in aliases.Where(normalized => !allRoutes.Contains(normalized)))
                allRoutes.Add(normalized);
        }

        var (classMetadata, classSkipped, classRequiresAuth) = CollectMetadata(ClassAttributeChain(type), $"{type.Name}");

        var handlers = ImmutableArray.CreateBuilder<HandlerModel>();

        foreach (var method in type.GetMembers().OfType<IMethodSymbol>()
                     .Where(m => m is
                     {
                         MethodKind: MethodKind.Ordinary,
                         DeclaredAccessibility: Accessibility.Public,
                         IsStatic: false,
                     }))
        {
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

            var (methodMetadata, methodSkipped, methodRequiresAuth) =
                CollectMetadata(method.GetAttributes(), $"{type.Name}.{method.Name}");

            handlers.Add(new HandlerModel(
                method.Name,
                verb,
                path,
                sub,
                ClassifyReturn(method.ReturnType),
                methodMetadata,
                methodSkipped,
                methodRequiresAuth,
                ExtractParams(method, path),
                ExtractInvokeParams(method)));
        }

        if (handlers.Count == 0) return null;

        return new PageModel(
            type.Name,
            type.ContainingNamespace.IsGlobalNamespace ? "" : type.ContainingNamespace.ToDisplayString(),
            basePath,
            allRoutes.ToImmutable(),
            "global::" + type.ToDisplayString(),
            classMetadata,
            classSkipped,
            classRequiresAuth,
            handlers.ToImmutable());
    }

    /// <summary>The class's attributes plus its base classes' (stopping under RaptorPage) — the closest
    /// symbol-world equivalent of the scanner's <c>GetCustomAttributes(inherit: true)</c>.</summary>
    private static IEnumerable<AttributeData> ClassAttributeChain(INamedTypeSymbol type)
    {
        for (var current = type; current is not null; current = current.BaseType)
        {
            var display = current.ToDisplayString();
            if (display is "object" or "Raptor21.RCL.Pages.RaptorPage" or "Raptor21.RCL.Pages.RaptorRoutableComponent")
                yield break;

            foreach (var attr in current.GetAttributes()) yield return attr;
        }
    }

    private static ReturnKind ClassifyReturn(ITypeSymbol returnType)
    {
        if (ImplementsIResult(returnType)) return ReturnKind.Sync;

        if (returnType is INamedTypeSymbol { IsGenericType: true, TypeArguments.Length: 1 } generic &&
            generic.TypeArguments[0].ToDisplayString() == "Microsoft.AspNetCore.Http.IResult")
        {
            var definition = generic.ConstructedFrom.ToDisplayString();
            // The scanner's result switch matches Task<IResult>/ValueTask<IResult> EXACTLY — Task<SomeResult>
            // falls through to its throw, and this classification mirrors that.
            if (definition == "System.Threading.Tasks.Task<TResult>") return ReturnKind.TaskOfResult;
            if (definition == "System.Threading.Tasks.ValueTask<TResult>") return ReturnKind.ValueTaskOfResult;
        }

        return ReturnKind.Unsupported;
    }

    private static bool ImplementsIResult(ITypeSymbol type) =>
        type.ToDisplayString() == "Microsoft.AspNetCore.Http.IResult" ||
        type.AllInterfaces.Any(i => i.ToDisplayString() == "Microsoft.AspNetCore.Http.IResult");

    /// <summary>Every parameter of a handler, in order, classified the way the scanner's BindArguments binds
    /// them: the context, the request's own CancellationToken, a simple route/query value, or a service.</summary>
    private static ImmutableArray<InvokeParam> ExtractInvokeParams(IMethodSymbol method)
    {
        var builder = ImmutableArray.CreateBuilder<InvokeParam>();

        foreach (var p in method.Parameters)
        {
            var display = p.Type.ToDisplayString();

            if (display == "Microsoft.AspNetCore.Http.HttpContext")
            {
                builder.Add(new InvokeParam(InvokeParamKind.Context, p.Name, SimpleKind.String, false, "", false));
            }
            else if (display == "System.Threading.CancellationToken")
            {
                builder.Add(new InvokeParam(InvokeParamKind.Cancellation, p.Name, SimpleKind.String, false, "", false));
            }
            else if (ClassifyParameter(p) is { } simple)
            {
                builder.Add(new InvokeParam(InvokeParamKind.Simple, p.Name, simple.Kind, simple.IsNullable, simple.Signature, false));
            }
            else
            {
                // The scanner resolves everything else from DI, defaulting only when the parameter declares a
                // default; a missing service without one throws. Value-typed service parameters cannot take
                // the null default, so they keep the throwing path.
                var serviceType = display.EndsWith("?", StringComparison.Ordinal)
                    ? display.Substring(0, display.Length - 1)
                    : display;
                var allowNull = p.HasExplicitDefaultValue && p.Type.IsReferenceType;

                builder.Add(new InvokeParam(InvokeParamKind.Service, p.Name, SimpleKind.String, false, "global::" + serviceType, allowNull));
            }
        }

        return builder.ToImmutable();
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
                var kind = KindFromConstraint(token.Constraint);
                builder.Add(new ParamModel(token.Name, kind, false, true, SignatureTypeForKind(kind, null, false)));
            }
        }

        foreach (var p in method.Parameters.Where(p => !consumed.Contains(p.Name))) // codeql[cs/linq/missed-where] the remaining guard binds its subject (ClassifyParameter)
        {
            // The remaining guard BINDS its subject (a DI-resolved parameter classifies to null), which a
            // .Where could only replicate by re-classifying or null-forgiving — the pattern stays.
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

    private static SimpleKind KindFromConstraint(string constraint) => constraint switch
    {
        "guid" => SimpleKind.Guid,
        "int" => SimpleKind.Int,
        "long" => SimpleKind.Long,
        "bool" => SimpleKind.Bool,
        "decimal" => SimpleKind.Decimal,
        "datetime" => SimpleKind.DateTime,
        _ => SimpleKind.String,
    };

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
        foreach (var model in models) // codeql[cs/linq/missed-where] seen.Add is a mutation guard; netstandard2.0 has no DistinctBy
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

        sb.AppendLine();
        EmitEndpointMember(sb, name, handler, "            ");
    }

    /// <summary>One endpoint accessor member — a const when the handler has no URL-relevant parameters, a
    /// builder method otherwise. Shared by the Routes classes and the RaptorModal-Id alias classes, which sit
    /// at different nesting depths — hence the explicit indent.</summary>
    private static void EmitEndpointMember(StringBuilder sb, string name, HandlerModel handler, string indent)
    {
        var urlParams = handler.Params.Where(p => !p.IsToken).ToList();
        var tokenParams = handler.Params.Where(p => p.IsToken).ToList();

        sb.AppendLine($"{indent}/// <summary><c>{handler.Verb} {handler.Path}</c> — <c>{handler.Name}</c> handler.</summary>");

        if (handler.Params.Length == 0)
        {
            sb.AppendLine($"{indent}public const string {name} = \"{handler.Path}\";");
            return;
        }

        // Route tokens first (path order is what the signature promises), then query params in declaration
        // order. Optionality: C# only allows trailing optionals, so defaults start at the last run of nullables.
        var ordered = tokenParams.Concat(urlParams).ToList();
        var firstOptional = ordered.Count;
        for (var i = ordered.Count - 1; i >= 0 && ordered[i].IsNullable && !ordered[i].IsToken; i--) firstOptional = i;

        var signature = string.Join(", ", ordered.Select((p, i) =>
            $"{p.SignatureType} {p.Name}{(i >= firstOptional ? " = null" : "")}"));

        sb.AppendLine($"{indent}public static string {name}({signature})");
        sb.AppendLine($"{indent}{{");
        sb.AppendLine($"{indent}    var sb = new global::System.Text.StringBuilder({PathExpression(handler.Path, tokenParams)});");

        if (urlParams.Count > 0)
        {
            sb.AppendLine($"{indent}    var sep = '?';");
            foreach (var p in urlParams)
            {
                if (p.IsNullable)
                {
                    sb.AppendLine($"{indent}    if ({p.Name} is {{ }} {p.Name}Value)");
                    sb.AppendLine($"{indent}    {{");
                    sb.AppendLine($"{indent}        sb.Append(sep).Append(\"{p.Name}=\").Append({ValueExpression(p.Kind, p.Name + "Value")});");
                    sb.AppendLine($"{indent}        sep = '&';");
                    sb.AppendLine($"{indent}    }}");
                }
                else
                {
                    sb.AppendLine($"{indent}    sb.Append(sep).Append(\"{p.Name}=\").Append({ValueExpression(p.Kind, p.Name)});");
                    sb.AppendLine($"{indent}    sep = '&';");
                }
            }
        }

        sb.AppendLine($"{indent}    return sb.ToString();");
        sb.AppendLine($"{indent}}}");
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
        ImmutableArray<string> AllRoutes,
        string FullTypeName,
        ImmutableArray<string> ClassMetadata,
        ImmutableArray<string> SkippedMetadata,
        bool ClassRequiresAuth,
        ImmutableArray<HandlerModel> Handlers);

    private sealed record HandlerModel(
        string Name,
        string Verb,
        string Path,
        string Template,
        ReturnKind Return,
        ImmutableArray<string> MethodMetadata,
        ImmutableArray<string> SkippedMetadata,
        bool MethodRequiresAuth,
        ImmutableArray<ParamModel> Params,
        ImmutableArray<InvokeParam> InvokeParams);

    private enum ReturnKind
    {
        Sync,
        TaskOfResult,
        ValueTaskOfResult,
        Unsupported,
    }

    private enum InvokeParamKind
    {
        Context,
        Cancellation,
        Simple,
        Service,
    }

    /// <summary>One handler parameter as the generated invoker binds it. For Simple, <c>TypeDisplay</c> is the
    /// signature type (incl. nullability); for Service, the unannotated service type.</summary>
    private sealed record InvokeParam(
        InvokeParamKind Category,
        string Name,
        SimpleKind Kind,
        bool IsNullable,
        string TypeDisplay,
        bool AllowNullService);

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
