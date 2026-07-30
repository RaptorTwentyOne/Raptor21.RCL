// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — HtmxSwapContent.

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;

namespace Raptor21.RCL.Composition;

/// <summary>Outlet that emits all per-request out-of-band (hx-swap-oob / hx-partial) content once, after the body.</summary>
public sealed class HtmxSwapContent : ComponentBase
{
    [Inject] private IHtmxSwapService SwapService { get; set; } = default!;

    /// <inheritdoc/>
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        if (SwapService.ContentAvailable)
            builder.AddContent(0, SwapService.RenderToFragment());
    }
}