using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Http;
using Raptor21.RCL.Grid.Components;
using Raptor21.RCL.Htmx;
using Raptor21.RCL.Rendering;

namespace Raptor21.RCL.Endpoints;

/// <summary>
/// <see cref="IResult"/> factories for the htmx endpoints a routable <c>.razor</c> page needs. A Razor Component
/// has no <c>?handler=</c>, so its grid re-render, its dialog, and its post-mutation refresh are minimal-API
/// routes — these collapse each to one line, keeping the mechanics (component rendering, the grid-refresh
/// trigger) here instead of hand-written in every page's endpoint. The page writes only its own routes and the
/// command it sends.
/// </summary>
public static class RaptorResults
{
    /// <summary>
    /// Renders <typeparamref name="TComponent"/> server-side to the HTML fragment htmx swaps in, passing the
    /// given component parameters. Prefer the strongly-typed <see cref="Component{TComponent}(Action{RaptorParameterBuilder{TComponent}})"/>
    /// overload for anything non-trivial; this loosely-typed form is fine for a stable one or two parameters.
    /// </summary>
    /// <example><code>() => RaptorResults.Component&lt;RolesGrid&gt;(("RouteBase", "/roles"))</code></example>
    public static IResult Component<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(params (string Name, object? Value)[] parameters)
        where TComponent : IComponent =>
        new RaptorComponentResult<TComponent>(
            parameters.Length == 0
                ? null
                : parameters.ToDictionary(p => p.Name, p => p.Value, StringComparer.Ordinal));

    /// <summary>
    /// Renders <typeparamref name="TComponent"/> to an htmx fragment, with its parameters built through the
    /// strongly-typed <see cref="RaptorParameterBuilder{TComponent}"/> — property-expression selected,
    /// type-checked, and <c>[EditorRequired]</c>-enforced at build time.
    /// </summary>
    /// <example><code>() => RaptorResults.Component&lt;RoleModal&gt;(p => p.Add(c => c.RoleId, id))</code></example>
    public static IResult Component<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(Action<RaptorParameterBuilder<TComponent>> configure)
        where TComponent : IComponent
    {
        ArgumentNullException.ThrowIfNull(configure);
        var builder = new RaptorParameterBuilder<TComponent>();
        configure(builder);
        return new RaptorComponentResult<TComponent>(builder.Build());
    }

    /// <summary>
    /// An empty <c>200</c> carrying the <c>HX-Trigger</c> the grid client turns into a reload of
    /// <paramref name="gridId"/> through its own form — so the grid's current page, sort and filters survive.
    /// The answer a save or delete returns after mutating.
    /// </summary>
    public static IResult GridRefresh(string gridId) => new GridRefreshResult(gridId);

    private sealed class GridRefreshResult(string gridId) : IResult
    {
        public Task ExecuteAsync(HttpContext httpContext)
        {
            if (httpContext.Request.IsHtmx())
#pragma warning disable IL2026 // the payload is a string: JSON-primitive, unaffected by trimming.
                httpContext.Response.Htmx().Trigger("raptor:grid-refresh", gridId);
#pragma warning restore IL2026
            return Task.CompletedTask;
        }
    }
}

/// <summary>
/// An <see cref="IResult"/> that renders a Razor component to an htmx fragment via
/// <see cref="RaptorComponentRenderer"/>. Prefer the <see cref="RaptorResults.Component{TComponent}(Action{RaptorParameterBuilder{TComponent}})"/>
/// factory.
/// </summary>
public sealed class RaptorComponentResult<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(IReadOnlyDictionary<string, object?>? parameters) : IResult
    where TComponent : IComponent
{
    public async Task ExecuteAsync(HttpContext httpContext)
    {
        var html = await RaptorComponentRenderer.RenderToStringAsync<TComponent>(httpContext, parameters);
        httpContext.Response.ContentType = "text/html; charset=utf-8";
        await httpContext.Response.WriteAsync(html);
    }
}