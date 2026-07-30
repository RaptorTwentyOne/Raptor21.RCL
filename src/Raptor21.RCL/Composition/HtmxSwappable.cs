// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — HtmxSwappable.

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Raptor21.RCL.Htmx;

namespace Raptor21.RCL.Composition;

/// <summary>
/// Wraps content in an htmx 4 <c>&lt;hx-partial&gt;</c> out-of-band swap targeting <see cref="TargetId"/>
/// (or <see cref="Selector"/>) with the given <see cref="SwapStyle"/>.
/// </summary>
public sealed class HtmxSwappable : ComponentBase
{
    /// <summary>The id of the element to swap into.</summary>
    [Parameter, EditorRequired] public string TargetId { get; set; } = default!;

    /// <summary>The swap style (default <see cref="SwapStyle.outerHTML"/>).</summary>
    [Parameter] public SwapStyle SwapStyle { get; set; } = SwapStyle.outerHTML;

    /// <summary>An explicit CSS selector, used instead of <c>#TargetId</c> when set.</summary>
    [Parameter] public string? Selector { get; set; }

    /// <summary>The content to swap.</summary>
    [Parameter, EditorRequired] public RenderFragment ChildContent { get; set; } = default!;

    /// <inheritdoc/>
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        var target = string.IsNullOrEmpty(Selector) ? $"#{TargetId}" : Selector;

        builder.OpenElement(0, "hx-partial");
        builder.AddAttribute(1, "hx-target", target);
        builder.AddAttribute(2, "hx-swap", SwapStyle.ToHtmxString());
        builder.AddContent(3, ChildContent);
        builder.CloseElement();
    }
}
