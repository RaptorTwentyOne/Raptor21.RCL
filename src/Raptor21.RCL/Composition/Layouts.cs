// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — the composition layouts.

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.AspNetCore.Http;
using Raptor21.RCL.Htmx;

namespace Raptor21.RCL.Composition;

/// <summary>
/// The application root component: wraps the rendered content in <see cref="HtmxLayout{T}"/>. Point
/// <c>RaptorConfig.RootComponent</c> at <c>HtmxApp&lt;YourLayout&gt;</c> (your full-page HTML-document layout).
/// </summary>
public sealed class HtmxApp<T> : ComponentBase where T : LayoutComponentBase
{
    /// <summary>The rendered view content.</summary>
    [Parameter]
    public RenderFragment ChildContent { get; set; } = default!;

    /// <inheritdoc/>
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenComponent<HtmxLayout<T>>(0);
        builder.AddComponentParameter(1, nameof(HtmxLayout<T>.IsRootComponent), true);
        builder.AddComponentParameter(2, nameof(LayoutComponentBase.Body), (RenderFragment)(b => b.AddContent(3, ChildContent)));
        builder.CloseComponent();
    }
}

/// <summary>
/// Selects the layout for the request: the real full-page layout <typeparamref name="T"/> for a normal
/// navigation, or a stripped-down layout for an htmx fragment request (so the swap gets no page chrome).
/// Adds <c>Vary: HX-Request</c> to every response, so a URL served both as a full page and as a fragment
/// is cached under separate keys.
/// </summary>
public sealed class HtmxLayout<T> : LayoutComponentBase where T : LayoutComponentBase
{
    [CascadingParameter] private HttpContext? HttpContext { get; set; }

    /// <summary>True when this is the outermost (root) layout.</summary>
    [Parameter]
    public bool IsRootComponent { get; set; }

    /// <inheritdoc/>
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        var isHtmx = HttpContext?.Request.IsHtmx() == true;

        HttpContext?.Response.Headers.TryAdd("Vary", HtmxRequestHeaderNames.HtmxRequest);

        if (isHtmx)
            builder.OpenComponent(0, IsRootComponent ? typeof(MinimalLayout) : typeof(EmptyLayout));
        else
            builder.OpenComponent<T>(0);

        builder.AddComponentParameter(1, nameof(LayoutComponentBase.Body), Body);
        builder.CloseComponent();
    }
}

/// <summary>A layout that renders only its body (no chrome).</summary>
internal sealed class EmptyLayout : LayoutComponentBase
{
    protected override void BuildRenderTree(RenderTreeBuilder builder) => builder.AddContent(0, Body);
}

/// <summary>A minimal full-document root used for htmx fragment responses at the root.</summary>
internal sealed class MinimalLayout : LayoutComponentBase
{
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenElement(0, "html");
        builder.OpenElement(1, "body");
        builder.AddContent(2, Body);
        builder.CloseElement();
        builder.CloseElement();
    }
}

/// <summary>The default root component when none is configured: a bare html/body document.</summary>
internal sealed class EmptyRootComponent : ComponentBase
{
    [Parameter] public RenderFragment ChildContent { get; set; } = default!;

    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenElement(0, "html");
        builder.OpenElement(1, "body");
        builder.AddContent(2, ChildContent);
        builder.CloseElement();
        builder.CloseElement();
    }
}