using Microsoft.AspNetCore.Razor.TagHelpers;

namespace Raptor21.RCL.Forms;

/// <summary>When the combobox offers a filter box.</summary>
public enum SelectSearch
{
    /// <summary>Only once the list is long enough that scanning it is work.</summary>
    Auto,
    Always,
    Never,
}

/// <summary>
/// Wraps a native <c>&lt;select&gt;</c> in a searchable, keyboard-navigable combobox.
/// <para>
/// The element inside is kept and stays the source of truth — the form posts it, model binding and
/// validation see it unchanged, and the control still works if the script never runs.
/// </para>
/// <example>
/// <code>
/// &lt;raptor-select placeholder="Choose a warehouse"&gt;
///     &lt;select asp-for="WarehouseId" asp-items="Model.Warehouses" class="…"&gt;&lt;/select&gt;
/// &lt;/raptor-select&gt;
/// </code>
/// <c>multiple</c> on the inner select gives a multi-select; <c>&lt;optgroup&gt;</c> renders as headings.
/// </example>
/// </summary>
[HtmlTargetElement("raptor-select")]
public sealed class RaptorSelectTagHelper : TagHelper
{
    /// <summary>Shown on the trigger while nothing is selected.</summary>
    public string? Placeholder { get; set; }

    public SelectSearch Search { get; set; } = SelectSearch.Auto;

    public string? Class { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        output.TagName = "div";
        output.TagMode = TagMode.StartTagAndEndTag;

        var css = "rg-select";
        if (!string.IsNullOrWhiteSpace(Class)) css += $" {Class}";
        output.Attributes.SetAttribute("class", css);
        output.Attributes.SetAttribute("data-rg-component", "select");
        output.Attributes.SetAttribute("data-rg-search", Search.ToString().ToLowerInvariant());
        if (!string.IsNullOrEmpty(Placeholder)) output.Attributes.SetAttribute("data-rg-placeholder", Placeholder);
    }
}

/// <summary>
/// A dropdown panel: a trigger plus arbitrary floating content.
/// <para>
/// Distinct from <see cref="RaptorSelectTagHelper"/>: a select edits a form value and behaves like a
/// listbox, whereas a dropdown holds whatever the page puts in it — an action menu, a column chooser,
/// a form fragment.
/// </para>
/// <example>
/// <code>
/// &lt;raptor-dropdown menu="true" search="true" placement="BottomEnd"&gt;
///     &lt;button data-rg-dropdown-trigger class="…"&gt;Actions&lt;/button&gt;
///     &lt;div data-rg-dropdown-panel&gt;
///         &lt;button class="rg-dd-item" data-rg-dropdown-item&gt;Export&lt;/button&gt;
///         &lt;div class="rg-dd-sep"&gt;&lt;/div&gt;
///         &lt;button class="rg-dd-item" data-rg-dropdown-item&gt;Delete&lt;/button&gt;
///     &lt;/div&gt;
/// &lt;/raptor-dropdown&gt;
/// </code>
/// Set <c>keep-open</c> for a panel the user works inside rather than picks from.
/// </example>
/// </summary>
[HtmlTargetElement("raptor-dropdown")]
public sealed class RaptorDropdownTagHelper : TagHelper
{
    /// <summary>Panel is a list of commands: arrows navigate it and picking one dismisses it.</summary>
    public bool Menu { get; set; }

    /// <summary>Render a filter box that hides non-matching items.</summary>
    public bool Search { get; set; }

    /// <summary>Clicking inside does not dismiss — for panels holding a form or a multi-step flow.</summary>
    public bool KeepOpen { get; set; }

    /// <summary>Widen the panel to at least the trigger's width.</summary>
    public bool MatchWidth { get; set; }

    public DropdownPlacement Placement { get; set; } = DropdownPlacement.BottomStart;

    public string? Class { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        output.TagName = "div";
        output.TagMode = TagMode.StartTagAndEndTag;

        var css = "rg-dd";
        if (!string.IsNullOrWhiteSpace(Class)) css += $" {Class}";
        output.Attributes.SetAttribute("class", css);
        output.Attributes.SetAttribute("data-rg-component", "dropdown");
        output.Attributes.SetAttribute("data-rg-placement", PlacementValue(Placement));

        if (Menu) output.Attributes.SetAttribute("data-rg-menu", string.Empty);
        if (Search) output.Attributes.SetAttribute("data-rg-search", string.Empty);
        if (KeepOpen) output.Attributes.SetAttribute("data-rg-keep-open", string.Empty);
        if (MatchWidth) output.Attributes.SetAttribute("data-rg-match-width", string.Empty);
    }

    private static string PlacementValue(DropdownPlacement placement) => placement switch
    {
        DropdownPlacement.BottomEnd => "bottom-end",
        DropdownPlacement.TopStart => "top-start",
        DropdownPlacement.TopEnd => "top-end",
        _ => "bottom-start",
    };
}

public enum DropdownPlacement
{
    BottomStart,
    BottomEnd,
    TopStart,
    TopEnd,
}
