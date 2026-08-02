namespace Raptor21.RCL.Layout;

/// <summary>
/// How loudly a <see cref="RaptorPageAction"/> paints itself WHEN IT IS INLINE.
/// <para>
/// It is called emphasis and not "variant" on purpose: it is a request, not a promise. The shell decides
/// where an action ends up — inline beside the title (one action, desktop) or as a row inside the "…" menu
/// (two or more, or any count on a phone) — and inside a menu the emphasis is FLATTENED away by
/// <c>_page-chrome.scss</c>. A menu whose rows are filled blocks of colour is a menu that has stopped being
/// a list; the same button sitting alone in the header row is the page's one visible verb and is the thing
/// the eye should land on. One node, two presentations, exactly as with every other property of this
/// component — nothing is cloned and no page has to know which surface it is on.
/// </para>
/// <para>
/// The set is deliberately SHORT, and it is not <c>ButtonVariant</c>. That enum has nine members because it
/// describes a button in a form or a dialog, where Warning/Info/Light/Ghost/Outline all mean something. A
/// page-level action has exactly two jobs the header needs to rank: "this is the page's create verb" and
/// "this produces a file". Mapping the other seven would be seven paint rules that no page asks for and that
/// would each need their own flattening rule in both menu surfaces.
/// </para>
/// </summary>
public enum PageActionEmphasis
{
    /// <summary>The default: the bordered, neutral button. Correct for anything that is not one of the
    /// two below — this is a header, not a toolbar, and more than one shouting button is none.</summary>
    None,

    /// <summary>The page's create/primary verb ("Add New EPC"), filled in <c>--rg-accent</c>. The same
    /// weight the consuming app already gives a <c>PrimaryAction</c> built from
    /// <c>RaptorButton Variant="Primary"</c>, so the two slots rank a create verb identically.</summary>
    Primary,

    /// <summary>A confirming/producing action — in practice the Excel exports — filled in
    /// <c>--rg-success</c>, which is what those buttons were before they moved into this slot.</summary>
    Success,
}
