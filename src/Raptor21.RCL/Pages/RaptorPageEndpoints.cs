using System.ComponentModel;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Raptor21.RCL.Pages;

/// <summary>
/// Discovers <see cref="RaptorPage"/> components tagged <see cref="RaptorPageAttribute"/> and maps each of their
/// <see cref="HtmxHandlerAttribute"/> methods to an endpoint — so a page owns its htmx routes without a controller
/// or a hand-written endpoints file. Any other attribute on the page class or handler method (e.g. an app's
/// <c>[Authorize]</c> or permission attribute) is copied onto the endpoint as metadata, so existing auth
/// middleware enforces it unchanged.
/// </summary>
public static class RaptorPageEndpoints
{
    /// <summary>
    /// Maps every <see cref="RaptorPage"/> handler found in <paramref name="assemblies"/> (the entry assembly by
    /// default). Call once in the endpoint pipeline, alongside <c>MapControllers</c>/<c>MapRazorPages</c>.
    /// </summary>
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("Discovers pages by assembly scanning and binds with per-request reflection. Trim-safe consumers should call the source-generated MapGeneratedRaptorPages() instead; this reflective path remains for assemblies built without the generator.")]
    public static IEndpointRouteBuilder MapRaptorPages(this IEndpointRouteBuilder endpoints, params Assembly[] assemblies)
    {
        if (assemblies.Length == 0)
            assemblies =
            [
                Assembly.GetEntryAssembly() ?? throw new InvalidOperationException(
                    "No entry assembly to scan; pass the assembly containing your RaptorPages to MapRaptorPages.")
            ];

        foreach (var pageType in assemblies.SelectMany(GetLoadableTypes)
                     .Where(type => !type.IsAbstract && typeof(RaptorPage).IsAssignableFrom(type)))
        {
            if (pageType.GetCustomAttribute<RaptorPageAttribute>() is not { } pageAttr) continue;

            IReadOnlyList<string> routes = pageAttr.Routes.Count > 0
                ? pageAttr.Routes
                : [RaptorRouteConvention.RouteFor(pageType.Name)];

            foreach (var basePath in routes.Select(rawRoute => "/" + rawRoute.Trim('/')))
            {
                foreach (var method in pageType.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                {
                    if (method.GetCustomAttribute<HtmxHandlerAttribute>() is not { } handler) continue;

                    var sub = string.IsNullOrWhiteSpace(handler.Template) ? "" : "/" + handler.Template!.Trim('/');
                    var route = sub.Length == 0 ? basePath : basePath + sub;

                    var capturedType = pageType;
                    var capturedMethod = method;
                    var builder = endpoints.MapMethods(route, [handler.Verb],
                        (Delegate)((HttpContext ctx) => InvokeAsync(capturedType, capturedMethod, ctx)));

                    ApplyMetadata(builder, pageType, method);
                }
            }
        }

        return endpoints;
    }

    /// <summary>Copy the page's and handler's own attributes onto the endpoint so auth middleware sees them.</summary>
    private static void ApplyMetadata(IEndpointConventionBuilder builder, Type pageType, MethodInfo method)
    {
        var requiresAuth = false;
        foreach (var attr in pageType.GetCustomAttributes(inherit: true)
                     .Concat(method.GetCustomAttributes(inherit: true))
                     .Where(attr => attr is not (HtmxHandlerAttribute or RaptorPageAttribute)))
        {
            builder.Add(b => b.Metadata.Add(attr));
            if (attr is IAuthorizeData) requiresAuth = true;
        }

        if (requiresAuth)
            builder.Add(b => b.Metadata.Add(new AuthorizeAttribute()));
    }

    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("Discovers pages by assembly scanning and binds with per-request reflection. Trim-safe consumers should call the source-generated MapGeneratedRaptorPages() instead; this reflective path remains for assemblies built without the generator.")]
    private static async Task<IResult> InvokeAsync(Type pageType, MethodInfo method, HttpContext ctx)
    {
        var page = (RaptorPage)Activator.CreateInstance(pageType)!;
        page.AttachContext(ctx);

        var result = method.Invoke(page, BindArguments(method, ctx));
        return result switch
        {
            IResult r => r,
            Task<IResult> t => await t,
            ValueTask<IResult> vt => await vt,
            null => throw new InvalidOperationException($"RaptorPage handler '{pageType.Name}.{method.Name}' returned null."),
            _ => throw new InvalidOperationException(
                $"RaptorPage handler '{pageType.Name}.{method.Name}' must return IResult, Task<IResult> or ValueTask<IResult>.")
        };
    }

    /// <summary>Bind handler parameters: the context, simple values from route/query, everything else from DI.</summary>
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("Discovers pages by assembly scanning and binds with per-request reflection. Trim-safe consumers should call the source-generated MapGeneratedRaptorPages() instead; this reflective path remains for assemblies built without the generator.")]
    private static object?[] BindArguments(MethodInfo method, HttpContext ctx)
    {
        var parameters = method.GetParameters();
        if (parameters.Length == 0) return [];

        var args = new object?[parameters.Length];
        for (var i = 0; i < parameters.Length; i++)
        {
            var p = parameters[i];
            var type = p.ParameterType;

            if (type == typeof(HttpContext)) args[i] = ctx;
            else if (type == typeof(CancellationToken)) args[i] = ctx.RequestAborted;
            else if (TryBindSimple(type, p.Name!, ctx, out var value)) args[i] = value;
            else
                args[i] = ctx.RequestServices.GetService(type)
                          ?? (p.HasDefaultValue
                              ? p.DefaultValue
                              : throw new InvalidOperationException($"Cannot bind handler parameter '{p.Name}' of type {type}."));
        }

        return args;
    }

    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("Discovers pages by assembly scanning and binds with per-request reflection. Trim-safe consumers should call the source-generated MapGeneratedRaptorPages() instead; this reflective path remains for assemblies built without the generator.")]
    private static bool TryBindSimple(Type type, string name, HttpContext ctx, out object? value)
    {
        value = null;
        var underlying = Nullable.GetUnderlyingType(type) ?? type;
        var isNullable = !type.IsValueType || Nullable.GetUnderlyingType(type) is not null;

        if (underlying != typeof(string) && underlying != typeof(Guid) && underlying != typeof(int) &&
            underlying != typeof(long) && underlying != typeof(bool) && underlying != typeof(decimal) &&
            underlying != typeof(DateTime) && !underlying.IsEnum)
            return false;

        var raw = ctx.Request.RouteValues.TryGetValue(name, out var rv) ? rv?.ToString() : null;
        if (string.IsNullOrEmpty(raw) && ctx.Request.Query.TryGetValue(name, out var qv)) raw = qv.ToString();

        if (string.IsNullOrEmpty(raw))
        {
            value = isNullable ? null : Activator.CreateInstance(underlying);
            return true;
        }

        if (underlying == typeof(string))
        {
            value = raw;
            return true;
        }

        try
        {
            value = TypeDescriptor.GetConverter(underlying).ConvertFromInvariantString(raw);
        }
        catch (Exception e) when (e is FormatException or NotSupportedException)
        {
            value = isNullable ? null : Activator.CreateInstance(underlying);
        }

        return true;
    }

    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("Discovers pages by assembly scanning and binds with per-request reflection. Trim-safe consumers should call the source-generated MapGeneratedRaptorPages() instead; this reflective path remains for assemblies built without the generator.")]
    private static IEnumerable<Type> GetLoadableTypes(Assembly assembly)
    {
        try
        {
            return assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException e)
        {
            return e.Types.Where(t => t is not null)!;
        }
    }
}