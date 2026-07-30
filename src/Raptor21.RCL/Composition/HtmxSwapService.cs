// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — IHtmxSwapService / HtmxSwapService.

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Http;
using Raptor21.RCL.Htmx;

namespace Raptor21.RCL.Composition;

/// <summary>
/// Per-request accumulator of out-of-band (htmx <c>hx-partial</c>) swaps. Add content during the main render;
/// it is emitted once at the <see cref="HtmxSwapContent"/> outlet.
/// </summary>
public interface IHtmxSwapService
{
    /// <summary>Adds a component to swap out-of-band into <paramref name="targetId"/>.</summary>
    void AddSwappableComponent<TComponent>(string targetId, Dictionary<string, object?>? parameters = null,
        SwapStyle swapStyle = SwapStyle.outerHTML, string? selector = null) where TComponent : IComponent;

    /// <summary>Adds a render fragment to swap out-of-band into <paramref name="targetId"/>.</summary>
    void AddSwappableFragment(string targetId, RenderFragment fragment,
        SwapStyle swapStyle = SwapStyle.outerHTML, string? selector = null);

    /// <summary>Adds markup to swap out-of-band into <paramref name="targetId"/>.</summary>
    void AddSwappableContent(string targetId, string content,
        SwapStyle swapStyle = SwapStyle.outerHTML, string? selector = null);

    /// <summary>Adds raw markup emitted as-is (no OOB wrapper).</summary>
    void AddRawContent(string content);

    /// <summary>Renders all accumulated content to a fragment (OOB items only on htmx requests).</summary>
    RenderFragment RenderToFragment();

    /// <summary>Clears all accumulated content.</summary>
    void Clear();

    /// <summary>Whether any content has been accumulated.</summary>
    bool ContentAvailable { get; }
}

/// <inheritdoc cref="IHtmxSwapService"/>
public sealed class HtmxSwapService(IHttpContextAccessor httpContextAccessor) : IHtmxSwapService
{
    private readonly List<ContentItem> _items = [];

    private HttpContext Http => httpContextAccessor.HttpContext
        ?? throw new InvalidOperationException("No active HttpContext for the OOB swap service.");

    private enum ContentKind { Swappable, Raw }

    private readonly record struct ContentItem(ContentKind Kind, string TargetId, SwapStyle SwapStyle, string Selector, RenderFragment Content);

    /// <inheritdoc/>
    public void AddSwappableComponent<TComponent>(string targetId, Dictionary<string, object?>? parameters = null,
        SwapStyle swapStyle = SwapStyle.outerHTML, string? selector = null) where TComponent : IComponent
    {
        RenderFragment component = builder =>
        {
            builder.OpenComponent(0, typeof(TComponent));
            if (parameters is not null)
            {
                var seq = 1;
                foreach (var parameter in parameters)
                    builder.AddComponentParameter(seq++, parameter.Key, parameter.Value);
            }

            builder.CloseComponent();
        };

        _items.Add(new ContentItem(ContentKind.Swappable, targetId, swapStyle, selector ?? string.Empty, component));
    }

    /// <inheritdoc/>
    public void AddSwappableFragment(string targetId, RenderFragment fragment,
        SwapStyle swapStyle = SwapStyle.outerHTML, string? selector = null) =>
        _items.Add(new ContentItem(ContentKind.Swappable, targetId, swapStyle, selector ?? string.Empty, fragment));

    /// <inheritdoc/>
    public void AddSwappableContent(string targetId, string content,
        SwapStyle swapStyle = SwapStyle.outerHTML, string? selector = null) =>
        _items.Add(new ContentItem(ContentKind.Swappable, targetId, swapStyle, selector ?? string.Empty,
            builder => builder.AddMarkupContent(0, content)));

    /// <inheritdoc/>
    public void AddRawContent(string content) =>
        _items.Add(new ContentItem(ContentKind.Raw, string.Empty, SwapStyle.none, string.Empty,
            builder => builder.AddMarkupContent(0, content)));

    /// <inheritdoc/>
    public RenderFragment RenderToFragment()
    {
        var items = _items.ToArray();
        var isHtmx = Http.Request.IsHtmx();

        return builder =>
        {
            foreach (var item in items)
            {
                if (item.Kind == ContentKind.Raw)
                {
                    builder.AddContent(0, item.Content);
                }
                else if (isHtmx)
                {
                    builder.OpenComponent<HtmxSwappable>(1);
                    builder.AddComponentParameter(2, nameof(HtmxSwappable.TargetId), item.TargetId);
                    builder.AddComponentParameter(3, nameof(HtmxSwappable.SwapStyle), item.SwapStyle);
                    builder.AddComponentParameter(4, nameof(HtmxSwappable.Selector), item.Selector);
                    builder.AddComponentParameter(5, nameof(HtmxSwappable.ChildContent), item.Content);
                    builder.CloseComponent();
                }
            }
        };
    }

    /// <inheritdoc/>
    public void Clear() => _items.Clear();

    /// <inheritdoc/>
    public bool ContentAvailable => _items.Count > 0;
}
