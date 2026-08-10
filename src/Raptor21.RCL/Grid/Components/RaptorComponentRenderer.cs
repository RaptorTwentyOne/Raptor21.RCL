using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Raptor21.RCL.Grid.Components;

/// <summary>
/// Renders a Razor Component to an HTML string, server-side, with the framework <see cref="HtmlRenderer"/>
/// — no route, no socket, no interactivity. This is how a grid's htmx POST is answered: the handler
/// re-renders the <c>&lt;RaptorGrid&gt;</c> component for the new filter/sort/page state and returns the
/// region markup for htmx to swap.
/// </summary>
public static class RaptorComponentRenderer
{
    public static async Task<string> RenderToStringAsync<TComponent>(
        HttpContext httpContext, IReadOnlyDictionary<string, object?>? parameters = null)
        where TComponent : IComponent
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        if (httpContext.Request.HasFormContentType)
            await httpContext.Request.ReadFormAsync();

        var services = httpContext.RequestServices;
        var loggerFactory = services.GetRequiredService<ILoggerFactory>();

        InitializeNavigation(services, httpContext);

        await using var renderer = new HtmlRenderer(services, loggerFactory);
        return await renderer.Dispatcher.InvokeAsync(async () =>
        {
            var pv = parameters is { Count: > 0 }
                ? ParameterView.FromDictionary(new Dictionary<string, object?>(parameters))
                : ParameterView.Empty;
            var root = await renderer.RenderComponentAsync<TComponent>(pv);
            return root.ToHtmlString();
        });
    }

    /// <summary>
    /// Seeds the scoped <see cref="NavigationManager"/> with the current request URI. The framework
    /// <see cref="HtmlRenderer"/> does not run the Blazor endpoint, so the manager is otherwise
    /// uninitialised and any component that reads its URI throws. A no-op when it is already initialised.
    ///
    /// The seeding goes through <see cref="Microsoft.AspNetCore.Components.Routing.IHostEnvironmentNavigationManager"/>
    /// — the same public contract the framework's own component endpoint uses — which is what lets this be
    /// plain interface dispatch instead of the private-member reflection it used to be (the library's
    /// single worst trim/AOT hazard). A manager that does not implement the interface cannot be seeded and
    /// is left alone.
    /// </summary>
    private static void InitializeNavigation(IServiceProvider services, HttpContext httpContext)
    {
        if (services.GetService<NavigationManager>()
            is not Microsoft.AspNetCore.Components.Routing.IHostEnvironmentNavigationManager nav) return;

        var request = httpContext.Request;
        var baseUri = $"{request.Scheme}://{request.Host}{request.PathBase}/";
        var fullUri = $"{request.Scheme}://{request.Host}{request.PathBase}{request.Path}{request.QueryString}";
        try
        {
            nav.Initialize(baseUri, fullUri);
        }
        catch (InvalidOperationException)
        {
            // Already initialised by the framework; the second call is redundant, not an error.
        }
    }
}