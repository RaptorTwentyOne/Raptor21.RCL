using Microsoft.AspNetCore.Razor.TagHelpers;

namespace Raptor21.RCL.Modals;

public enum ModalSize
{
    Small,
    Medium,
    Large,
    ExtraLarge,
    /// <summary>Fills the viewport. For editors and anything with its own internal layout.</summary>
    Full,
}

/// <summary>
/// A modal dialog.
/// <para>
/// <c>&lt;raptor-modal&gt;</c> wraps the dialog's content in place, so the form and its dialog live in one
/// file. The dialog is opened by returning this markup from the server and letting htmx swap it in; there
/// is no client-side open API.
/// </para>
/// <example>
/// A page handler returns the dialog, htmx swaps it into a container, and it opens:
/// <code>
/// &lt;raptor-modal title="Edit role" size="Large"&gt;
///     &lt;form hx-post="?handler=SaveRole" hx-target="#modal-host"&gt;
///         ...
///         &lt;button type="button" data-rg-modal-close&gt;Cancel&lt;/button&gt;
///         &lt;button type="submit"&gt;Save&lt;/button&gt;
///     &lt;/form&gt;
/// &lt;/raptor-modal&gt;
/// </code>
/// Any element inside may carry <c>data-rg-modal-close</c> to dismiss it, and
/// <c>data-rg-autofocus</c> to take focus on open.
/// </example>
/// </summary>
[HtmlTargetElement("raptor-modal")]
public sealed class RaptorModalTagHelper : TagHelper
{
    /// <summary>Heading text. Omit to render no header — the content then owns the whole dialog.</summary>
    public string? Title { get; set; }

    public ModalSize Size { get; set; } = ModalSize.Medium;

    /// <summary>
    /// Suppresses dismissal by backdrop click and Escape, for dialogs where an accidental dismissal
    /// would lose work or leave an operation half-done.
    /// </summary>
    public bool Static { get; set; }

    /// <summary>Render the close (×) button in the header.</summary>
    public bool Dismissible { get; set; } = true;

    /// <summary>Extra classes on the dialog element.</summary>
    public string? Class { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        var titleId = $"rg-modal-title-{context.UniqueId}";

        // A NATIVE <dialog>, not a <div>: Client/src/modal/ModalComponent.ts opens it with showModal(),
        // which is the only way to sit above the sidebar rail. The rail is a popover, i.e. in the top
        // layer, and no z-index in the normal layer reaches the top layer — measured, a probe at
        // z-index 2147483647 still hit-tested underneath an open rail. It renders CLOSED and the
        // stylesheet keeps it that way until showModal() runs, so nothing paints in the normal layer.
        output.TagName = "dialog";
        output.TagMode = TagMode.StartTagAndEndTag;
        output.Attributes.SetAttribute("class", "rg-modal");
        output.Attributes.SetAttribute("data-rg-component", "modal");
        if (Static) output.Attributes.SetAttribute("data-rg-modal-static", string.Empty);
        if (!string.IsNullOrEmpty(Title)) output.Attributes.SetAttribute("aria-labelledby", titleId);

        var dialogClass = $"rg-modal-dialog rg-modal-{SizeClass(Size)}";
        if (!string.IsNullOrWhiteSpace(Class)) dialogClass += $" {Class}";

        var header = string.IsNullOrEmpty(Title) && !Dismissible
            ? string.Empty
            : $"""
               <div class="rg-modal-head">
                 {(string.IsNullOrEmpty(Title) ? "" : $"""<h2 class="rg-modal-title" id="{titleId}">{Title}</h2>""")}
                 {(Dismissible ? """<button type="button" class="rg-modal-x" data-rg-modal-close aria-label="Close">&times;</button>""" : "")}
               </div>
               """;

        output.PreContent.AppendHtml($"""<div class="{dialogClass}" data-rg-modal-dialog>{header}<div class="rg-modal-body">""");
        output.PostContent.AppendHtml("</div></div>");
    }

    private static string SizeClass(ModalSize size) => size switch
    {
        ModalSize.Small => "sm",
        ModalSize.Large => "lg",
        ModalSize.ExtraLarge => "xl",
        ModalSize.Full => "full",
        _ => "md",
    };
}
