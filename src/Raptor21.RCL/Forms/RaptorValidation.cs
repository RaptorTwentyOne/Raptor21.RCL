using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Raptor21.RCL.Forms;

/// <summary>Renders the validation error for one field from the cascaded MVC <see cref="ModelStateDictionary"/>.</summary>
public sealed class RaptorValidationMessage : ComponentBase
{
    [CascadingParameter] private ModelStateDictionary? ModelState { get; set; }

    /// <summary>The model field / key whose error to show.</summary>
    [Parameter, EditorRequired]
    public string For { get; set; } = default!;

    /// <summary>CSS class for the message element (default <c>rg-field-error</c>).</summary>
    [Parameter]
    public string Class { get; set; } = "rg-field-error";

    /// <inheritdoc/>
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        if (ModelState is null ||
            !ModelState.TryGetValue(For, out var entry) ||
            entry.Errors.Count == 0)
        {
            return;
        }

        var message = entry.Errors[0].ErrorMessage;
        if (string.IsNullOrEmpty(message))
            return;

        builder.OpenElement(0, "span");
        builder.AddAttribute(1, "class", Class);
        builder.AddContent(2, message);
        builder.CloseElement();
    }
}

/// <summary>Renders all validation errors from the cascaded MVC <see cref="ModelStateDictionary"/> as a list.</summary>
public sealed class RaptorValidationSummary : ComponentBase
{
    [CascadingParameter] private ModelStateDictionary? ModelState { get; set; }

    /// <summary>CSS class for the summary list (default <c>rg-validation-summary</c>).</summary>
    [Parameter]
    public string Class { get; set; } = "rg-validation-summary";

    /// <inheritdoc/>
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        if (ModelState is null || ModelState.IsValid)
            return;

        var messages = ModelState
            .SelectMany(kv => kv.Value?.Errors ?? [])
            .Select(e => e.ErrorMessage)
            .Where(m => !string.IsNullOrEmpty(m))
            .ToList();

        if (messages.Count == 0)
            return;

        builder.OpenElement(0, "ul");
        builder.AddAttribute(1, "class", Class);
        foreach (var message in messages)
        {
            builder.OpenElement(2, "li");
            builder.AddContent(3, message);
            builder.CloseElement();
        }

        builder.CloseElement();
    }
}