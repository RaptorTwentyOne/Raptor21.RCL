// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — RzView.

using System.Collections.Concurrent;
using System.Reflection;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.CompilerServices;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Extensions.Options;

namespace Raptor21.RCL.Composition;

/// <summary>How a <see cref="RaptorView"/> renders.</summary>
internal enum RaptorViewMode
{
    /// <summary>Full page: root component + auto/default layout + head injection.</summary>
    Page,

    /// <summary>htmx fragment: no root, no page layout (renders through <see cref="EmptyLayout"/>).</summary>
    Partial,
}

/// <summary>
/// Renders a target component dynamically with optional full-page composition (root component + layout + head),
/// MVC ModelState cascading, and the out-of-band swap outlet. Driven via <c>RazorComponentResult&lt;RaptorView&gt;</c>.
/// </summary>
internal sealed class RaptorView : ComponentBase
{
    private static readonly ConcurrentDictionary<Type, Type?> LayoutAttributeCache = new();
    private Type? _resolvedLayout;

    [Inject] private IOptions<RaptorConfig> Config { get; set; } = default!;

    /// <summary>The component to render.</summary>
    [Parameter, EditorRequired] public required Type ComponentType { get; set; }

    /// <summary>The parameters passed to the rendered component.</summary>
    [Parameter, EditorRequired] public required IDictionary<string, object?> ComponentParameters { get; set; }

    /// <summary>MVC model state cascaded through the tree (for form validation).</summary>
    [Parameter] public ModelStateDictionary? ModelState { get; set; }

    /// <summary>Page (full) or Partial (fragment).</summary>
    [Parameter] public RaptorViewMode Mode { get; set; } = RaptorViewMode.Page;

    /// <inheritdoc/>
    protected override void OnParametersSet() =>
        _resolvedLayout = Mode == RaptorViewMode.Partial ? typeof(EmptyLayout) : ResolveAutoLayout();

    /// <inheritdoc/>
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        CreateCascadingValue(builder, ModelState, bodyBuilder =>
        {
            RenderFragment content = contentBuilder =>
            {
                RenderBody(contentBuilder);
                contentBuilder.OpenComponent<HtmxSwapContent>(100);
                contentBuilder.CloseComponent();
            };

            if (Mode == RaptorViewMode.Page)
            {
                bodyBuilder.OpenComponent<HeadContent>(1);
                bodyBuilder.AddComponentParameter(2, nameof(HeadContent.ChildContent), (RenderFragment)(headBuilder =>
                {
                    headBuilder.OpenComponent<HtmxConfigHeadOutlet>(3);
                    headBuilder.CloseComponent();
                }));
                bodyBuilder.CloseComponent();

                bodyBuilder.OpenComponent(5, Config.Value.RootComponent ?? typeof(EmptyRootComponent));
                bodyBuilder.AddAttribute(6, "ChildContent", content);
                bodyBuilder.CloseComponent();
            }
            else
            {
                content(bodyBuilder);
            }
        });
    }

    private void RenderBody(RenderTreeBuilder builder)
    {
        if (_resolvedLayout is not null)
        {
            builder.OpenComponent<LayoutView>(10);
            builder.AddComponentParameter(11, nameof(LayoutView.Layout), RuntimeHelpers.TypeCheck<Type>(_resolvedLayout));
            builder.AddAttribute(12, nameof(LayoutView.ChildContent), (RenderFragment)RenderDynamicComponent);
            builder.CloseComponent();
            return;
        }

        RenderDynamicComponent(builder);
    }

    private void RenderDynamicComponent(RenderTreeBuilder builder)
    {
        builder.OpenComponent<DynamicComponent>(20);
        builder.AddComponentParameter(21, nameof(DynamicComponent.Type), RuntimeHelpers.TypeCheck<Type>(ComponentType));
        builder.AddComponentParameter(22, nameof(DynamicComponent.Parameters), RuntimeHelpers.TypeCheck<IDictionary<string, object?>>(ComponentParameters));
        builder.CloseComponent();
    }

    private Type? ResolveAutoLayout()
    {
        if (!LayoutAttributeCache.TryGetValue(ComponentType, out var layout))
        {
            layout = ComponentType.GetCustomAttribute<LayoutAttribute>()?.LayoutType;
            LayoutAttributeCache.TryAdd(ComponentType, layout);
        }

        return layout ?? Config.Value.DefaultLayout;
    }

    private static void CreateCascadingValue<TValue>(RenderTreeBuilder builder, TValue value, RenderFragment fragment)
    {
        builder.OpenComponent<CascadingValue<TValue>>(0);
        builder.AddComponentParameter(1, nameof(CascadingValue<TValue>.Value), value);
        builder.AddComponentParameter(2, nameof(CascadingValue<TValue>.ChildContent), fragment);
        builder.CloseComponent();
    }
}
