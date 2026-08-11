using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Extensions.DependencyInjection;
using Raptor21.RCL.Composition;
using Raptor21.RCL.Endpoints;
using Raptor21.RCL.Htmx;
using Raptor21.RCL.Rendering;

namespace Raptor21.RCL.Pages;

/// <summary>
/// A routable page that <b>is</b> a Razor component and <b>owns</b> its htmx handlers as co-located code-behind
/// methods — no separate controller or endpoints file. Put the markup in <c>Page.razor</c>
/// (<c>@inherits RaptorPage</c>) and the handlers in <c>Page.razor.cs</c>, each tagged
/// <see cref="HtmxGetAttribute"/>/<see cref="HtmxPostAttribute"/>; <see cref="RaptorPageEndpoints.MapRaptorPages"/>
/// wires them. A handler returns <see cref="Page"/> (render this page full), <see cref="Partial{TComponent}(Action{RaptorParameterBuilder{TComponent}}, ModelStateDictionary?)"/>
/// (an htmx fragment) or <see cref="GridRefresh"/>.
/// </summary>
public abstract class RaptorPage : RaptorSequentialComponent
{
    private HttpContext? _httpContext;

    /// <summary>The current request. Available inside handler methods (never during component rendering).</summary>
    protected HttpContext HttpContext =>
        _httpContext ?? throw new InvalidOperationException(
            "HttpContext is only available inside a RaptorPage handler method, not during rendering.");

    /// <summary>Set by <see cref="RaptorPageEndpoints"/> before a handler runs.</summary>
    internal void AttachContext(HttpContext httpContext) => _httpContext = httpContext;

    private IRaptorViewService Views => HttpContext.RequestServices.GetRequiredService<IRaptorViewService>();

    /// <summary>Resolve a service for the current request (the co-located equivalent of constructor injection).</summary>
    protected TService Service<TService>() where TService : notnull =>
        HttpContext.RequestServices.GetRequiredService<TService>();

    /// <summary>Render <b>this</b> page as a full page: root shell + layout + head.</summary>
    [System.Diagnostics.CodeAnalysis.UnconditionalSuppressMessage("Trimming", "IL2072",
        Justification = "GetType() of a live page instance: the type was constructed statically (generated registration) and is therefore rooted with its members.")]
    protected IResult Page(ModelStateDictionary? modelState = null) => Views.View(GetType(), data: null, modelState);

    /// <summary>Render a component as an htmx fragment (no chrome), parameters via the strongly-typed builder.</summary>
    protected IResult Partial<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(Action<RaptorParameterBuilder<TComponent>> configure, ModelStateDictionary? modelState = null)
        where TComponent : IComponent => Views.PartialView(configure, modelState);

    /// <summary>Render a component as an htmx fragment (no chrome), parameters from an object/dictionary (null = none).</summary>
    protected IResult Partial<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(object? data = null, ModelStateDictionary? modelState = null)
        where TComponent : IComponent => Views.PartialView<TComponent>(data, modelState);

    /// <summary>An empty <c>200</c> carrying the <c>HX-Trigger</c> that reloads <paramref name="gridId"/>.</summary>
    protected IResult GridRefresh(string gridId) => RaptorResults.GridRefresh(gridId);

    /// <summary>
    /// Answers a successful inline cell-save (<c>POST {Endpoint}/cell</c>): re-renders the grid component and
    /// retargets the swap from the edited <c>&lt;tr&gt;</c> to the whole grid region. The cell POST already
    /// carries the grid form's state via <c>hx-include</c>, so page/sort/filters survive the re-render — and the
    /// swapped-in rows show database truth without a dedicated single-row render path.
    /// </summary>
    protected IResult GridCellSaved<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(string gridId, Action<RaptorParameterBuilder<TComponent>> configure)
        where TComponent : IComponent
    {
        HttpContext.Response.Htmx().Retarget($"#{gridId}-region").Reswap("outerHTML");
        return Partial(configure);
    }

    /// <summary>
    /// Rejects an inline cell-save: a plain-text <c>422</c> whose body the inline editor shows next to the
    /// cell (the client reopens the editor with the typed value and this message).
    /// </summary>
    protected static IResult GridCellError(string message) =>
        Results.Text(message, statusCode: StatusCodes.Status422UnprocessableEntity);

    /// <summary>
    /// Answers a successful row reorder (<c>POST {Endpoint}/reorder</c>): re-renders the grid component and
    /// retargets the swap from the dragged <c>&lt;tr&gt;</c> to the whole grid region — the
    /// <see cref="GridCellSaved{TComponent}"/> pattern. The reorder POST carries the grid form's state, so
    /// paging and column order survive, and the swapped-in rows show the stored order rather than the
    /// client's optimistic move.
    /// </summary>
    protected IResult GridRowMoved<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(string gridId, Action<RaptorParameterBuilder<TComponent>> configure)
        where TComponent : IComponent
    {
        HttpContext.Response.Htmx().Retarget($"#{gridId}-region").Reswap("outerHTML");
        return Partial(configure);
    }

    /// <summary>
    /// Rejects a row reorder: a plain-text <c>422</c> whose body the client surfaces before triggering
    /// <c>raptor:refresh</c>, which puts the rows back in server truth.
    /// </summary>
    protected static IResult GridRowMoveError(string message) =>
        Results.Text(message, statusCode: StatusCodes.Status422UnprocessableEntity);
}

/// <summary>
/// Semantic base for a <see cref="RaptorPage"/> tagged <see cref="RaptorComponentAttribute"/>: a routable
/// component (modal, panel...) rather than a full page. Inherits <see cref="RaptorPage.Page"/> but fragment
/// components normally return <see cref="RaptorPage.Partial{TComponent}(Action{RaptorParameterBuilder{TComponent}}, ModelStateDictionary?)"/>
/// instead.
/// </summary>
public abstract class RaptorRoutableComponent : RaptorPage;