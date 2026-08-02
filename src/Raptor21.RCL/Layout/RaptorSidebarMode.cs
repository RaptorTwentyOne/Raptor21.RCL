namespace Raptor21.RCL.Layout;

/// <summary>
/// How <see cref="RaptorSidebar"/> presents itself in one viewport band.
/// <para>
/// The mode is chosen per band — <c>MobileMode</c> below 992px, <c>DesktopMode</c> from 992px up — because
/// the server cannot know the viewport. Both values are written to the rail as data attributes and the
/// band split is made in CSS; nothing branches on width on the server, and nothing is written to the
/// consumer's <c>&lt;html&gt;</c> element.
/// </para>
/// <para>
/// Open/closed is NOT part of this enum. Every visible mode uses one mechanism for that — the native
/// <c>popover</c> attribute the rail carries unconditionally — so <c>:popover-open</c> is the single state
/// selector, and Esc, light-dismiss, focus return and the scrim come from the user agent.
/// </para>
/// </summary>
public enum RaptorSidebarMode
{
    /// <summary>
    /// Rides over the content with a scrim (the popover's <c>::backdrop</c>). Nothing else on the page
    /// moves. This is the default below 992px.
    /// </summary>
    Drawer,

    /// <summary>
    /// Pushes the layout: the content offsets by the rail's width while the rail is open, and the rail
    /// slides in on the same clock so the whole app frame moves as one piece.
    /// <para>
    /// The offset is a <c>translate</c> on the element marked <c>rg-sidebar-pushed</c>, plus — optionally
    /// — on any fixed chrome marked <c>rg-sidebar-pushed-chrome</c> (a persistent top bar or glass layer
    /// that lives outside the content column and must travel with it). Only a transform carries a bar's
    /// own <c>position: fixed</c> children along with it; a margin moves the bar's box and leaves them
    /// behind.
    /// </para>
    /// <para>
    /// The resting value is <c>translate: none</c>, never <c>0</c> — <c>0</c> computes to a value and
    /// would make the element a containing block for every <c>position: fixed</c> descendant permanently.
    /// While the rail is open that containing block does exist, and every surface THIS LIBRARY renders
    /// inside the pushed column is in the top layer, so all of them resolve against the viewport
    /// regardless: <c>&lt;dialog&gt;.showModal()</c> for modal/confirm/progress, <c>popover</c> for
    /// toasts, dropdown and select panels, the grid filter drawer, RaptorFilterPanel — and the grid's
    /// filter FAB, which is a <c>popover="manual"</c> shown at mount.
    /// </para>
    /// <para>
    /// THE FAB IS WHY THAT LIST HAD TO BE COMPLETED RATHER THAN JUST TRUSTED. This paragraph used to
    /// name two surfaces as being outside the top layer and dismiss them with "cannot be reached while a
    /// rail is open". The FAB was a third, and that excuse never covered it: it is on screen AT REST, so
    /// it did not need to be reached. Measured on /roles at 500x823, pushed box <c>[0,56,495,723]</c>:
    /// FAB at rest <c>[395,663,84,44]</c>, first frame of the rail opening <c>[395.2,719]</c> — 56px
    /// down in ONE frame, before any horizontal movement. Being in the top layer also means the
    /// ancestor's transform no longer reaches it, so the FAB carries its own matching <c>translate</c>
    /// on the same token, duration and easing as the other movers (<c>_sidebar.scss</c> §4b) and the
    /// frame still moves as one piece.
    /// </para>
    /// <para>
    /// A CONSUMER'S OWN fixed descendants of the pushed column are still subject to the containing
    /// block while the rail is open; this library cannot enumerate those, which is why the resting value
    /// stays <c>none</c> instead of becoming a permanent <c>0</c>. See <c>styles/layout/_sidebar.scss</c>
    /// §1b, §4 and §4b for the measurements.
    /// </para>
    /// </summary>
    Push,

    /// <summary>
    /// Icon rail: always visible, collapsed to <c>--rg-sidebar-w-rail</c>. Selecting it flips
    /// <c>--rg-sidebar-w</c>, so the rail, its fixed brand header and the consumer's content offset all
    /// resize from one token.
    /// </summary>
    Rail,

    /// <summary>In flow, full width, always visible. The default from 992px up.</summary>
    Docked,

    /// <summary>
    /// Not presented in this band. When BOTH bands are <c>Off</c> the component renders nothing at all;
    /// when only one is, the rail stays in the document and that band hides it in CSS (the server has no
    /// viewport to branch on).
    /// </summary>
    Off
}
