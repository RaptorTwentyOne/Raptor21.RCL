namespace Raptor21.RCL.Grid;

/// <summary>
/// Where the card-mode filter drawer is opened from.
/// <para>
/// The drawer itself never moves: it is rendered inside the grid region on both settings, and so are its
/// close affordances and its "clear all". Only the OPENER changes surface, and it changes by DECLARATION
/// rather than by re-parenting a node — moving the floating action button into the page's overflow menu
/// would leave a stale copy behind after the first region swap (the region replaces its own
/// <c>outerHTML</c>, which re-creates the button while the moved one lives on outside it).
/// </para>
/// </summary>
public enum RaptorGridFilterEntry
{
    /// <summary>
    /// The floating action button the region renders for itself, bottom-right, above the pager. The
    /// default, and the behaviour of every grid that says nothing.
    /// </summary>
    Fab,

    /// <summary>
    /// The page shell's "…" menu. The grid stops painting its FAB and drops the footer reservation the
    /// FAB needs; the page is expected to place a <c>&lt;RaptorGridFilterButton For="…"/&gt;</c> in its
    /// <c>RaptorPageChrome</c>.
    /// <para>
    /// The FAB is still RENDERED — hidden in CSS, not removed — so the arrangement degrades to
    /// <see cref="Fab"/> rather than to no filter at all: a client-side assertion takes the mark back off
    /// when the promised menu entry is not in the document, and the FAB reappears in the same frame.
    /// </para>
    /// </summary>
    PageChrome
}
