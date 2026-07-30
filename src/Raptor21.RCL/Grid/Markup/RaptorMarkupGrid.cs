using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Raptor21.RCL.Grid.Markup;

/// <summary>
/// The whole typed-markup-columns seam. A page renders its <see cref="RaptorGridColumns{TRow}"/>
/// column-def component once, headless, via the framework <see cref="HtmlRenderer"/> — no route, no
/// socket, no interactivity — so the declared columns land in the request <see cref="RaptorMarkupGridSink"/>,
/// and this returns the finished <see cref="GridView{TRow}"/>. The page's <c>BuildView()</c> just returns
/// that; the grid, its POST handler, the region partial and the htmx wiring are those of the fluent path.
/// </summary>
public static class RaptorMarkupGrid
{
    /// <summary>
    /// Render <typeparamref name="TColumns"/> (a component whose root is <see cref="RaptorGridColumns{TRow}"/>)
    /// and return the columns it declared as a typed <see cref="GridView{TRow}"/>. Call once per request
    /// from both the GET handler and the grid's <c>OnPostGridAsync</c>, then return the result from
    /// <c>BuildView()</c>.
    /// </summary>
    public static async Task<GridView<TRow>> BuildViewAsync<TColumns, TRow>(HttpContext httpContext)
        where TColumns : IComponent
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        var services = httpContext.RequestServices;
        var sink = services.GetRequiredService<RaptorMarkupGridSink>();
        var loggerFactory = services.GetRequiredService<ILoggerFactory>();

        await using var renderer = new HtmlRenderer(services, loggerFactory);
        await renderer.Dispatcher.InvokeAsync(async () => await renderer.RenderComponentAsync<TColumns>());

        return sink.BuildView<TRow>();
    }
}
