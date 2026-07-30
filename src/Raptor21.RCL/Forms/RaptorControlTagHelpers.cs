using System.Globalization;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.AspNetCore.Razor.TagHelpers;

namespace Raptor21.RCL.Forms;

/// <summary>Shared resolution of a control's <c>name</c>/<c>id</c>/<c>value</c> from either an
/// <c>asp-for</c> model expression or explicit attributes. Explicit values always win.</summary>
internal static class FormBinding
{
    public readonly record struct Result(string? Name, string? Id, string? Value, bool Required);

    public static Result Resolve(
        ModelExpression? forExpr, ViewContext? viewContext, string? name, string? id, string? value)
    {
        var required = false;

        if (forExpr is not null)
        {
            name ??= viewContext is not null
                ? viewContext.ViewData.TemplateInfo.GetFullHtmlFieldName(forExpr.Name)
                : forExpr.Name;
            value ??= FormatValue(forExpr.Model);
            required = forExpr.Metadata.IsRequired;
        }

        id ??= string.IsNullOrEmpty(name) ? null : TagBuilder.CreateSanitizedId(name, "_");
        return new Result(name, id, value, required);
    }

    private static string? FormatValue(object? model) => model switch
    {
        null => null,
        string s => s,
        bool b => b ? "true" : "false",
        DateTime dt => dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => model.ToString(),
    };
}

/// <summary>
/// A labelled field wrapper — the box that holds a control together with its label, optional hint and
/// the required marker. Wrap any control (a <c>raptor-input</c>, a <c>raptor-select</c>, or bare markup)
/// so every field in a dialog lines up the same way.
/// <example>
/// <code>
/// &lt;raptor-field label="E-mail" for="Email" required&gt;
///     &lt;raptor-input asp-for="Form.Email" type="email" /&gt;
/// &lt;/raptor-field&gt;
/// </code>
/// Set <c>fieldset</c> for a group of checkboxes or radios: the wrapper becomes a
/// <c>&lt;fieldset&gt;</c> and the label a <c>&lt;legend&gt;</c>, which is what a screen reader expects.
/// </example>
/// </summary>
[HtmlTargetElement("raptor-field")]
public sealed class RaptorFieldTagHelper : TagHelper
{
    /// <summary>Label text. Omit to render the wrapper with no label — for a control that carries its own.</summary>
    public string? Label { get; set; }

    /// <summary>The <c>id</c> of the control this labels, so clicking the label focuses it.</summary>
    public string? For { get; set; }

    /// <summary>Append a star and mark the field visually required.</summary>
    public bool Required { get; set; }

    /// <summary>Muted helper text shown after the label.</summary>
    public string? Hint { get; set; }

    /// <summary>Render as a <c>&lt;fieldset&gt;</c>/<c>&lt;legend&gt;</c> instead of <c>&lt;div&gt;</c>/<c>&lt;label&gt;</c>.</summary>
    public bool Fieldset { get; set; }

    public string? Class { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        output.TagName = Fieldset ? "fieldset" : "div";
        output.TagMode = TagMode.StartTagAndEndTag;

        var css = "rg-field";
        if (!string.IsNullOrWhiteSpace(Class)) css += $" {Class}";
        output.Attributes.SetAttribute("class", css);

        if (string.IsNullOrEmpty(Label)) return;

        var enc = System.Text.Encodings.Web.HtmlEncoder.Default;
        var star = Required ? " <span aria-hidden=\"true\">*</span>" : string.Empty;
        var hint = string.IsNullOrEmpty(Hint) ? string.Empty : $" <span class=\"rg-label-hint\">{enc.Encode(Hint)}</span>";

        if (Fieldset)
        {
            output.PreContent.AppendHtml($"<legend class=\"rg-label\">{enc.Encode(Label)}{star}{hint}</legend>");
        }
        else
        {
            var forAttr = string.IsNullOrEmpty(For) ? string.Empty : $" for=\"{enc.Encode(For)}\"";
            output.PreContent.AppendHtml($"<label class=\"rg-label\"{forAttr}>{enc.Encode(Label)}{star}{hint}</label>");
        }
    }
}

/// <summary>
/// A text input. Emits a native <c>&lt;input class="rg-input"&gt;</c>; there is nothing to enhance on the
/// client, so this is a pure server-render. Give it a <c>label</c> to have it wrap itself in a
/// <c>raptor-field</c>, or leave the label off and place it inside one yourself.
/// <example>
/// <code>
/// &lt;raptor-input asp-for="Form.FullName" label="Full name" required autofocus /&gt;
/// &lt;raptor-input name="Search" type="search" placeholder="Filter…" /&gt;
/// </code>
/// </example>
/// </summary>
[HtmlTargetElement("raptor-input")]
public sealed class RaptorInputTagHelper : TagHelper
{
    [HtmlAttributeName("asp-for")] public ModelExpression? For { get; set; }
    [HtmlAttributeNotBound, ViewContext] public ViewContext ViewContext { get; set; } = default!;

    /// <summary>When set, self-wraps in a labelled <c>raptor-field</c>.</summary>
    public string? Label { get; set; }

    public string? Hint { get; set; }
    public string Type { get; set; } = "text";
    public string? Name { get; set; }
    public string? Id { get; set; }
    public string? Value { get; set; }
    public string? Placeholder { get; set; }
    public bool Required { get; set; }
    public bool Disabled { get; set; }
    public bool Readonly { get; set; }
    public bool Autofocus { get; set; }
    public string? Autocomplete { get; set; }
    public string? Class { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        var bind = FormBinding.Resolve(For, ViewContext, Name, Id, Value);
        var required = Required || bind.Required;

        var input = new TagBuilder("input") { TagRenderMode = TagRenderMode.SelfClosing };
        input.Attributes["type"] = Type;
        if (!string.IsNullOrEmpty(bind.Name)) input.Attributes["name"] = bind.Name;
        if (!string.IsNullOrEmpty(bind.Id)) input.Attributes["id"] = bind.Id;
        if (bind.Value is not null) input.Attributes["value"] = bind.Value;
        if (!string.IsNullOrEmpty(Placeholder)) input.Attributes["placeholder"] = Placeholder;
        if (!string.IsNullOrEmpty(Autocomplete)) input.Attributes["autocomplete"] = Autocomplete;
        if (required) input.Attributes["required"] = "required";
        if (Disabled) input.Attributes["disabled"] = "disabled";
        if (Readonly) input.Attributes["readonly"] = "readonly";
        if (Autofocus) input.Attributes["data-rg-autofocus"] = string.Empty;

        var cls = "rg-input";
        if (!string.IsNullOrWhiteSpace(Class)) cls += $" {Class}";
        input.Attributes["class"] = cls;

        FormControls.Emit(output, input, Label, Hint, required, bind.Id);
    }
}

/// <summary>A multi-line text input. Emits <c>&lt;textarea class="rg-textarea"&gt;</c>.</summary>
[HtmlTargetElement("raptor-textarea")]
public sealed class RaptorTextareaTagHelper : TagHelper
{
    [HtmlAttributeName("asp-for")] public ModelExpression? For { get; set; }
    [HtmlAttributeNotBound, ViewContext] public ViewContext ViewContext { get; set; } = default!;

    public string? Label { get; set; }
    public string? Hint { get; set; }
    public string? Name { get; set; }
    public string? Id { get; set; }
    public string? Value { get; set; }
    public string? Placeholder { get; set; }
    public int Rows { get; set; } = 3;
    public bool Required { get; set; }
    public bool Disabled { get; set; }
    public bool Readonly { get; set; }
    public string? Class { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        var bind = FormBinding.Resolve(For, ViewContext, Name, Id, Value);
        var required = Required || bind.Required;

        var textarea = new TagBuilder("textarea") { TagRenderMode = TagRenderMode.Normal };
        if (!string.IsNullOrEmpty(bind.Name)) textarea.Attributes["name"] = bind.Name;
        if (!string.IsNullOrEmpty(bind.Id)) textarea.Attributes["id"] = bind.Id;
        textarea.Attributes["rows"] = Rows.ToString(CultureInfo.InvariantCulture);
        if (!string.IsNullOrEmpty(Placeholder)) textarea.Attributes["placeholder"] = Placeholder;
        if (required) textarea.Attributes["required"] = "required";
        if (Disabled) textarea.Attributes["disabled"] = "disabled";
        if (Readonly) textarea.Attributes["readonly"] = "readonly";
        if (bind.Value is not null) textarea.InnerHtml.Append(bind.Value);

        var cls = "rg-textarea";
        if (!string.IsNullOrWhiteSpace(Class)) cls += $" {Class}";
        textarea.Attributes["class"] = cls;

        FormControls.Emit(output, textarea, Label, Hint, required, bind.Id);
    }
}

/// <summary>
/// A single checkbox with an inline label. With <c>asp-for</c> bound to a <c>bool</c> it also emits the
/// hidden companion input, so an unchecked box posts <c>false</c> instead of nothing — the difference
/// that otherwise makes "turn a flag off" silently fail on edit. For a checkbox that contributes to a
/// collection (many boxes, one name), use explicit <c>name</c>/<c>value</c> and no hidden input is added.
/// </summary>
[HtmlTargetElement("raptor-checkbox")]
public sealed class RaptorCheckboxTagHelper : TagHelper
{
    [HtmlAttributeName("asp-for")] public ModelExpression? For { get; set; }
    [HtmlAttributeNotBound, ViewContext] public ViewContext ViewContext { get; set; } = default!;

    public string? Label { get; set; }
    public string? Name { get; set; }
    public string? Id { get; set; }
    public string Value { get; set; } = "true";
    public bool Checked { get; set; }
    public bool Disabled { get; set; }
    public string? Title { get; set; }
    public string? Class { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        var bind = FormBinding.Resolve(For, ViewContext, Name, Id, null);
        var isChecked = For is not null ? For.Model is true : Checked;
        var wantsHidden = For is not null && For.Metadata.ModelType == typeof(bool);

        output.TagName = "label";
        output.TagMode = TagMode.StartTagAndEndTag;
        var cls = "rg-check";
        if (!string.IsNullOrWhiteSpace(Class)) cls += $" {Class}";
        output.Attributes.SetAttribute("class", cls);
        if (!string.IsNullOrEmpty(Title)) output.Attributes.SetAttribute("title", Title);

        var input = new TagBuilder("input") { TagRenderMode = TagRenderMode.SelfClosing };
        input.Attributes["type"] = "checkbox";
        if (!string.IsNullOrEmpty(bind.Name)) input.Attributes["name"] = bind.Name;
        if (!string.IsNullOrEmpty(bind.Id)) input.Attributes["id"] = bind.Id;
        input.Attributes["value"] = Value;
        if (isChecked) input.Attributes["checked"] = "checked";
        if (Disabled) input.Attributes["disabled"] = "disabled";

        if (wantsHidden && !string.IsNullOrEmpty(bind.Name))
        {
            var hidden = new TagBuilder("input") { TagRenderMode = TagRenderMode.SelfClosing };
            hidden.Attributes["type"] = "hidden";
            hidden.Attributes["name"] = bind.Name;
            hidden.Attributes["value"] = "false";
            output.PreContent.AppendHtml(hidden);
        }

        output.Content.AppendHtml(input);
        if (!string.IsNullOrEmpty(Label))
        {
            var span = new TagBuilder("span");
            span.InnerHtml.Append(Label);
            output.Content.AppendHtml(span);
        }
    }
}

/// <summary>
/// A checkbox drawn as a toggle switch. Same binding as <see cref="RaptorCheckboxTagHelper"/> — a real
/// checkbox underneath — so it posts and binds identically; only the presentation differs.
/// </summary>
[HtmlTargetElement("raptor-switch")]
public sealed class RaptorSwitchTagHelper : TagHelper
{
    [HtmlAttributeName("asp-for")] public ModelExpression? For { get; set; }
    [HtmlAttributeNotBound, ViewContext] public ViewContext ViewContext { get; set; } = default!;

    public string? Label { get; set; }
    public string? Name { get; set; }
    public string? Id { get; set; }
    public string Value { get; set; } = "true";
    public bool Checked { get; set; }
    public bool Disabled { get; set; }
    public string? Class { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        var bind = FormBinding.Resolve(For, ViewContext, Name, Id, null);
        var isChecked = For is not null ? For.Model is true : Checked;
        var wantsHidden = For is not null && For.Metadata.ModelType == typeof(bool);

        output.TagName = "label";
        output.TagMode = TagMode.StartTagAndEndTag;
        var cls = "rg-switch";
        if (!string.IsNullOrWhiteSpace(Class)) cls += $" {Class}";
        output.Attributes.SetAttribute("class", cls);

        var input = new TagBuilder("input") { TagRenderMode = TagRenderMode.SelfClosing };
        input.Attributes["type"] = "checkbox";
        input.Attributes["class"] = "rg-switch-input";
        if (!string.IsNullOrEmpty(bind.Name)) input.Attributes["name"] = bind.Name;
        if (!string.IsNullOrEmpty(bind.Id)) input.Attributes["id"] = bind.Id;
        input.Attributes["value"] = Value;
        if (isChecked) input.Attributes["checked"] = "checked";
        if (Disabled) input.Attributes["disabled"] = "disabled";

        if (wantsHidden && !string.IsNullOrEmpty(bind.Name))
        {
            var hidden = new TagBuilder("input") { TagRenderMode = TagRenderMode.SelfClosing };
            hidden.Attributes["type"] = "hidden";
            hidden.Attributes["name"] = bind.Name;
            hidden.Attributes["value"] = "false";
            output.PreContent.AppendHtml(hidden);
        }

        output.Content.AppendHtml(input);
        output.Content.AppendHtml(new TagBuilder("span") { Attributes = { ["class"] = "rg-switch-track" } });
        if (!string.IsNullOrEmpty(Label))
        {
            var span = new TagBuilder("span");
            span.Attributes["class"] = "rg-switch-label";
            span.InnerHtml.Append(Label);
            output.Content.AppendHtml(span);
        }
    }
}

/// <summary>A file input styled to match the rest of the kit. Emits <c>&lt;input type="file"&gt;</c>.</summary>
[HtmlTargetElement("raptor-file")]
public sealed class RaptorFileTagHelper : TagHelper
{
    [HtmlAttributeName("asp-for")] public ModelExpression? For { get; set; }
    [HtmlAttributeNotBound, ViewContext] public ViewContext ViewContext { get; set; } = default!;

    public string? Label { get; set; }
    public string? Hint { get; set; }
    public string? Name { get; set; }
    public string? Id { get; set; }
    public string? Accept { get; set; }
    public bool Multiple { get; set; }
    public bool Required { get; set; }
    public bool Disabled { get; set; }
    public string? Class { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        var bind = FormBinding.Resolve(For, ViewContext, Name, Id, null);
        var required = Required || bind.Required;

        var input = new TagBuilder("input") { TagRenderMode = TagRenderMode.SelfClosing };
        input.Attributes["type"] = "file";
        if (!string.IsNullOrEmpty(bind.Name)) input.Attributes["name"] = bind.Name;
        if (!string.IsNullOrEmpty(bind.Id)) input.Attributes["id"] = bind.Id;
        if (!string.IsNullOrEmpty(Accept)) input.Attributes["accept"] = Accept;
        if (Multiple) input.Attributes["multiple"] = "multiple";
        if (required) input.Attributes["required"] = "required";
        if (Disabled) input.Attributes["disabled"] = "disabled";

        var cls = "rg-file";
        if (!string.IsNullOrWhiteSpace(Class)) cls += $" {Class}";
        input.Attributes["class"] = cls;

        FormControls.Emit(output, input, Label, Hint, required, bind.Id);
    }
}

/// <summary>
/// A date (or date-and-time) field. Emits the browser's <b>native</b> <c>&lt;input type="date"&gt;</c> —
/// or <c>datetime-local</c> when a time is wanted — rather than a scripted calendar, so the platform's
/// own picker opens (the OS date/time wheel on a phone) and no client component ships with it. Only the
/// field's presentation is supplied here: the <c>rg-input</c> styling and the theme-aware picker via
/// <c>color-scheme</c>.
/// <example>
/// <code>
/// &lt;raptor-date asp-for="Form.BirthDate" label="Birth date" /&gt;
/// &lt;raptor-date asp-for="Form.StartsAt" label="Starts" include-time /&gt;
/// </code>
/// </example>
/// </summary>
[HtmlTargetElement("raptor-date")]
public sealed class RaptorDateTagHelper : TagHelper
{
    [HtmlAttributeName("asp-for")] public ModelExpression? For { get; set; }
    [HtmlAttributeNotBound, ViewContext] public ViewContext ViewContext { get; set; } = default!;

    /// <summary>When set, self-wraps in a labelled <c>raptor-field</c>.</summary>
    public string? Label { get; set; }

    public string? Hint { get; set; }
    public string? Name { get; set; }
    public string? Id { get; set; }
    public string? Value { get; set; }

    /// <summary>Render a <c>datetime-local</c> input (date + time) instead of a date-only one.</summary>
    public bool IncludeTime { get; set; }

    /// <summary>Earliest / latest allowed value, in the same wire format the input posts
    /// (<c>yyyy-MM-dd</c>, or <c>yyyy-MM-ddTHH:mm</c> with a time).</summary>
    public string? Min { get; set; }
    public string? Max { get; set; }

    public bool Required { get; set; }
    public bool Disabled { get; set; }
    public bool Autofocus { get; set; }
    public string? Class { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        var bind = FormBinding.Resolve(For, ViewContext, Name, Id, null);
        var required = Required || bind.Required;
        var value = Value ?? FormatDate(For?.Model, IncludeTime);

        var input = new TagBuilder("input") { TagRenderMode = TagRenderMode.SelfClosing };
        input.Attributes["type"] = IncludeTime ? "datetime-local" : "date";
        if (!string.IsNullOrEmpty(bind.Name)) input.Attributes["name"] = bind.Name;
        if (!string.IsNullOrEmpty(bind.Id)) input.Attributes["id"] = bind.Id;
        if (!string.IsNullOrEmpty(value)) input.Attributes["value"] = value;
        if (!string.IsNullOrEmpty(Min)) input.Attributes["min"] = Min;
        if (!string.IsNullOrEmpty(Max)) input.Attributes["max"] = Max;
        if (required) input.Attributes["required"] = "required";
        if (Disabled) input.Attributes["disabled"] = "disabled";
        if (Autofocus) input.Attributes["data-rg-autofocus"] = string.Empty;

        var cls = "rg-input rg-date";
        if (!string.IsNullOrWhiteSpace(Class)) cls += $" {Class}";
        input.Attributes["class"] = cls;

        FormControls.Emit(output, input, Label, Hint, required, bind.Id);
    }

    /// <summary>Formats a model value into what a native date / datetime-local input expects. A time is
    /// only emitted when the field includes one, so a date-only field never posts a 00:00 component.</summary>
    private static string? FormatDate(object? model, bool includeTime) => model switch
    {
        null => null,
        DateTime dt => dt.ToString(includeTime ? "yyyy-MM-ddTHH:mm" : "yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateTimeOffset dto => dto.ToString(includeTime ? "yyyy-MM-ddTHH:mm" : "yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        string s => s,
        _ => model.ToString(),
    };
}

/// <summary>Carries the group's <c>name</c> and current value from a <c>raptor-radio-group</c> down to
/// the <c>raptor-radio</c> children nested inside it.</summary>
internal sealed record RadioGroupState(string? Name, string? SelectedValue);

/// <summary>
/// A set of radio buttons sharing one name — pick one of several. The group owns the <c>name</c> (and,
/// with <c>asp-for</c>, the selected value); each <c>raptor-radio</c> inside only states its own value
/// and label, so the shared name is written once rather than repeated on every option.
/// <example>
/// <code>
/// &lt;raptor-radio-group asp-for="Form.Channel" label="Notify via"&gt;
///     &lt;raptor-radio value="email" label="E-mail" /&gt;
///     &lt;raptor-radio value="sms" label="SMS" /&gt;
/// &lt;/raptor-radio-group&gt;
/// </code>
/// </example>
/// </summary>
[HtmlTargetElement("raptor-radio-group")]
public sealed class RaptorRadioGroupTagHelper : TagHelper
{
    internal const string StateKey = "RaptorRadioGroupState";

    [HtmlAttributeName("asp-for")] public ModelExpression? For { get; set; }
    [HtmlAttributeNotBound, ViewContext] public ViewContext ViewContext { get; set; } = default!;

    public string? Label { get; set; }
    public string? Name { get; set; }
    public string? Hint { get; set; }

    /// <summary>The selected option's value. Taken from <c>asp-for</c> when bound.</summary>
    public string? Value { get; set; }

    public bool Required { get; set; }

    /// <summary>Lay the options out in a row rather than stacked.</summary>
    public bool Inline { get; set; }

    public string? Class { get; set; }

    public override void Init(TagHelperContext context)
    {
        var bind = FormBinding.Resolve(For, ViewContext, Name, null, Value);
        context.Items[StateKey] = new RadioGroupState(bind.Name, bind.Value ?? For?.Model?.ToString());
    }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        var required = Required || (For?.Metadata.IsRequired ?? false);

        output.TagName = "fieldset";
        output.TagMode = TagMode.StartTagAndEndTag;
        var css = "rg-field rg-radio-group";
        if (Inline) css += " rg-radio-inline";
        if (!string.IsNullOrWhiteSpace(Class)) css += $" {Class}";
        output.Attributes.SetAttribute("class", css);

        if (string.IsNullOrEmpty(Label)) return;

        var enc = System.Text.Encodings.Web.HtmlEncoder.Default;
        var star = required ? " <span aria-hidden=\"true\">*</span>" : string.Empty;
        var hint = string.IsNullOrEmpty(Hint) ? string.Empty : $" <span class=\"rg-label-hint\">{enc.Encode(Hint)}</span>";
        output.PreContent.AppendHtml($"<legend class=\"rg-label\">{enc.Encode(Label)}{star}{hint}</legend>");
    }
}

/// <summary>One option in a <see cref="RaptorRadioGroupTagHelper"/>. Reads the shared name and selected
/// value from the enclosing group; an explicit <c>name</c>/<c>checked</c> still overrides, so a radio can
/// also stand alone in a hand-built layout.</summary>
[HtmlTargetElement("raptor-radio")]
public sealed class RaptorRadioTagHelper : TagHelper
{
    public string? Name { get; set; }
    public string? Value { get; set; }
    public string? Label { get; set; }
    public bool Checked { get; set; }
    public bool Disabled { get; set; }
    public string? Title { get; set; }
    public string? Class { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        var state = context.Items.TryGetValue(RaptorRadioGroupTagHelper.StateKey, out var raw)
            ? raw as RadioGroupState
            : null;
        var name = Name ?? state?.Name;
        var isChecked = Checked || (state?.SelectedValue is not null && Value is not null && state.SelectedValue == Value);

        output.TagName = "label";
        output.TagMode = TagMode.StartTagAndEndTag;
        var cls = "rg-check rg-radio";
        if (!string.IsNullOrWhiteSpace(Class)) cls += $" {Class}";
        output.Attributes.SetAttribute("class", cls);
        if (!string.IsNullOrEmpty(Title)) output.Attributes.SetAttribute("title", Title);

        var input = new TagBuilder("input") { TagRenderMode = TagRenderMode.SelfClosing };
        input.Attributes["type"] = "radio";
        if (!string.IsNullOrEmpty(name)) input.Attributes["name"] = name;
        if (Value is not null) input.Attributes["value"] = Value;
        if (isChecked) input.Attributes["checked"] = "checked";
        if (Disabled) input.Attributes["disabled"] = "disabled";

        output.Content.AppendHtml(input);
        if (!string.IsNullOrEmpty(Label))
        {
            var span = new TagBuilder("span");
            span.InnerHtml.Append(Label);
            output.Content.AppendHtml(span);
        }
    }
}

/// <summary>When the button is filled, outlined, quiet, or an icon.</summary>
public enum ButtonVariant
{
    /// <summary>The default: an outlined, neutral button.</summary>
    Secondary,
    /// <summary>The primary action of a form or dialog — one per group.</summary>
    Primary,
    /// <summary>A destructive action.</summary>
    Danger,
    /// <summary>A confirming/positive action.</summary>
    Success,
    /// <summary>A cautioning action.</summary>
    Warning,
    /// <summary>An informational action.</summary>
    Info,
    /// <summary>A soft, low-contrast neutral fill.</summary>
    Light,
    /// <summary>Outlined in the accent colour, filling in on hover — the "outline-primary" look.</summary>
    Outline,
    /// <summary>No border or fill until hovered — for low-emphasis actions in dense rows.</summary>
    Ghost,
}

public enum ButtonSize
{
    Small,
    Medium,
    Large,
}

/// <summary>
/// A button, in the variants and sizes the kit's <c>rg-btn</c> classes cover.
/// <para>
/// It defaults to <c>type="button"</c>, not the HTML default of <c>submit</c>, so a button placed inside
/// a form does not submit it on click. A submit button states so explicitly: <c>type="submit"</c>.
/// </para>
/// <example>
/// <code>
/// &lt;raptor-button variant="Primary" type="submit"&gt;Save changes&lt;/raptor-button&gt;
/// &lt;raptor-button variant="Danger" icon="ri-delete-bin-line"&gt;Delete&lt;/raptor-button&gt;
/// &lt;raptor-button variant="Ghost" icon="ri-more-2-line" icon-only aria-label="More" /&gt;
/// </code>
/// </example>
/// </summary>
[HtmlTargetElement("raptor-button")]
public sealed class RaptorButtonTagHelper : TagHelper
{
    public ButtonVariant Variant { get; set; } = ButtonVariant.Secondary;
    public ButtonSize Size { get; set; } = ButtonSize.Medium;

    /// <summary>Button behaviour. Defaults to <c>button</c>; set <c>submit</c> to submit the form.</summary>
    public string Type { get; set; } = "button";

    /// <summary>An icon-font class rendered before the label, e.g. <c>ri-add-line</c>.</summary>
    public string? Icon { get; set; }

    /// <summary>Square, icon-only button. Provide an <c>aria-label</c> so it stays accessible.</summary>
    public bool IconOnly { get; set; }

    public bool Disabled { get; set; }
    public string? Class { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        output.TagName = "button";
        output.TagMode = TagMode.StartTagAndEndTag;
        output.Attributes.SetAttribute("type", Type);
        if (Disabled) output.Attributes.SetAttribute("disabled", "disabled");

        var cls = "rg-btn";
        cls += Variant switch
        {
            ButtonVariant.Primary => " rg-btn-primary",
            ButtonVariant.Danger => " rg-btn-danger",
            ButtonVariant.Success => " rg-btn-success",
            ButtonVariant.Warning => " rg-btn-warning",
            ButtonVariant.Info => " rg-btn-info",
            ButtonVariant.Light => " rg-btn-light",
            ButtonVariant.Outline => " rg-btn-outline",
            ButtonVariant.Ghost => " rg-btn-ghost",
            _ => string.Empty,
        };
        cls += Size switch
        {
            ButtonSize.Small => " rg-btn-sm",
            ButtonSize.Large => " rg-btn-lg",
            _ => string.Empty,
        };
        if (IconOnly) cls += " rg-btn-icon";
        if (!string.IsNullOrWhiteSpace(Class)) cls += $" {Class}";
        output.Attributes.SetAttribute("class", cls);

        if (!string.IsNullOrEmpty(Icon))
        {
            var i = new TagBuilder("i");
            i.Attributes["class"] = Icon;
            i.Attributes["aria-hidden"] = "true";
            output.PreContent.AppendHtml(i);
        }
    }
}

/// <summary>Shared final step for the single-control helpers: emit the control bare, or — when a
/// <c>label</c> was given — wrapped in a labelled <c>rg-field</c>.</summary>
internal static class FormControls
{
    public static void Emit(
        TagHelperOutput output, TagBuilder control, string? label, string? hint, bool required, string? controlId)
    {
        if (string.IsNullOrEmpty(label))
        {
            output.TagName = null;
            output.Content.SetHtmlContent(control);
            return;
        }

        var enc = System.Text.Encodings.Web.HtmlEncoder.Default;
        var star = required ? " <span aria-hidden=\"true\">*</span>" : string.Empty;
        var hintHtml = string.IsNullOrEmpty(hint) ? string.Empty : $" <span class=\"rg-label-hint\">{enc.Encode(hint)}</span>";
        var forAttr = string.IsNullOrEmpty(controlId) ? string.Empty : $" for=\"{enc.Encode(controlId)}\"";

        output.TagName = "div";
        output.TagMode = TagMode.StartTagAndEndTag;
        output.Attributes.SetAttribute("class", "rg-field");
        output.PreContent.AppendHtml($"<label class=\"rg-label\"{forAttr}>{enc.Encode(label)}{star}{hintHtml}</label>");
        output.Content.SetHtmlContent(control);
    }
}
