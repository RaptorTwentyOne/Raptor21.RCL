/** Small DOM helpers shared by every component. */

import {topDialog} from './dialog-stack'

/**
 * Whether this browser has the popover API at all.
 *
 * Guards the `:popover-open` test in `portalTarget`: `matches(':popover-open')` THROWS a SyntaxError on
 * an engine that does not know the selector, and that call sits on the open path of every dropdown and
 * select — an unguarded throw there is a control that never opens at all. Same guard, same reason, as
 * `HAS_POPOVER` in runtime/page-chrome.ts.
 */
const HAS_POPOVER = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype

/** `typeof`, not a bare reference: the identifier does not exist at all on an engine without `<dialog>`,
 *  and `x instanceof Undeclared` throws a ReferenceError rather than answering false. */
const HAS_DIALOG = typeof HTMLDialogElement !== 'undefined'

/**
 * Every element type that can put itself in the TOP LAYER.
 *
 * Two mechanisms, one layer: `popover` (the rail, the shell menus, the toast stack) and
 * `<dialog>.showModal()` (every `.rg-modal`). They are ordered against each other by OPENING ORDER, not
 * by z-index — measured, Chrome 390x844: with the rail showing as a popover, a `<body>` child at
 * z-index 300 / 400 / 500 / 600 / 700 AND 2147483647 was returned BELOW the rail by
 * `elementsFromPoint` in all six cases. `--rg-z-*` is an intra-layer scale and cannot reach across.
 *
 * `dialog` is in the selector because the modal became a real `<dialog>`: leaving it out made
 * `portalTarget` answer `<body>` while a modal was open, and a panel parked there was measured
 * VISIBLE BUT DEAD — `elementsFromPoint` returned the dialog and a real click fired no listener,
 * because `showModal()` makes everything that is not a descendant of the dialog inert. Re-parenting the
 * same panel INTO the open dialog put it back on top and the click fired.
 */
const TOP_LAYER = HAS_POPOVER ? '[popover], dialog' : 'dialog'

/**
 * Whether `host` is currently IN the top layer.
 *
 * The test differs per mechanism and that is the whole reason this is a function: a `<dialog>` reports
 * `open`, a popover reports `:popover-open`, and asking a dialog for `:popover-open` is false for an
 * open dialog while asking a popover for `.open` is `undefined`. Both matter — the rail carries
 * `popover` at every width but is a docked column above 992px, and a `<dialog>` in the markup is only
 * modal once `showModal()` has run.
 */
function inTopLayer(host: HTMLElement): boolean {
    if (HAS_DIALOG && host instanceof HTMLDialogElement) return host.open
    return HAS_POPOVER && host.matches(':popover-open')
}

/**
 * Marks a surface that must stay INTERACTIVE while something else owns the top layer, and therefore has
 * to be re-parented into whatever that something is.
 *
 * Only the toast stack carries it today. A toast is not a passive banner: `NotifyManager.show()` puts a
 * `.rg-toast__close` button in every toast and error toasts have `duration: 0`, so they stay until that
 * button is pressed. Left as a `<body>` child under an open modal it was measured visible and dead —
 * an error the user cannot dismiss for as long as the dialog is open.
 *
 * The contract is deliberately an attribute rather than a hard-coded id: this module has no business
 * importing the notification manager, and a consumer with its own always-on surface can opt in.
 */
export const TOP_LAYER_GUEST = '[data-rg-top-layer-guest]'

/**
 * The element an UNANCHORED top-layer surface has to be parented to right now — the top-most open modal
 * dialog, or `<body>` when there is none.
 *
 * `portalTarget` answers the same question for a surface that HAS an anchor (a dropdown belongs to its
 * trigger, so the walk starts there). A toast belongs to nobody, so the only available answer is "the
 * thing that is currently making everything else inert".
 *
 * THE SHARED STACK FIRST, THE DOM ONLY AS A FALLBACK — and the difference is a real defect, not a
 * preference. This used to be a DOM scan alone, taking the LAST connected `dialog[open]` in DOCUMENT
 * order on the reasoning that dialogs are appended to one container as they open. They are not all in
 * one container: `ModalComponent`'s live in `#modal-container` while `NotifyManager` appends its
 * confirm to the end of `<body>`. So with a confirm already up and a modal opened OVER it, document
 * order names the confirm — and a toast handed to the confirm while the modal covers it is a toast
 * inside an inert subtree, visible with a dead close button, which is the exact failure the whole
 * top-layer-guest mechanism exists to prevent. `topDialog()` answers in OPENING order, which is the
 * order the top layer itself is in (core/dialog-stack.ts).
 *
 * The DOM scan is kept for the case the stack cannot know about: a `<dialog>` the HOST application
 * opened itself, without going through `openDialog`. Reached only when the stack is empty, so it can
 * never override a dialog this library actually owns.
 */
export function topLayerHost(): HTMLElement {
    const tracked = topDialog()
    if (tracked) return tracked

    const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
    let host: HTMLElement | null = null
    for (const dialog of dialogs) if (dialog.isConnected) host = dialog
    return host ?? document.body
}

/**
 * Puts `guest` back on top of the top layer without closing it.
 *
 * Order in the top layer is the order things were SHOWN, and nothing re-orders it in place. Measured:
 * with a `popover="manual"` box open first and the rail opened after it, `elementsFromPoint` returned
 * `[#sidebar-scroll, #sidebar, #probe-manual3]` — the rail on top of the toast. `hidePopover()` followed
 * by `showPopover()` on the same element returned `[#probe-manual3, #sidebar-scroll, #sidebar]` and left
 * the rail OPEN (`railStillOpen: true`), because a `manual` popover neither light-dismisses nor is
 * light-dismissed.
 *
 * Guarded rather than checked: `hidePopover()` throws on an element that is not showing, and
 * `showPopover()` throws on one that is already showing or is disconnected. The state can legitimately
 * be either here — the guest may have just been moved between hosts, which drops it from the top layer.
 */
export function restackTopLayerGuest(guest: HTMLElement): void {
    if (!HAS_POPOVER || !guest.isConnected || !guest.hasAttribute('popover')) return
    try {
        guest.hidePopover()
    } catch {
        /* was not showing — nothing to take down */
    }
    try {
        guest.showPopover()
    } catch {
        /* raced with a removal — the next toast re-resolves the container anyway */
    }
}

/**
 * Moves every top-layer guest into `host` and re-stacks it on top.
 *
 * Called on both edges of a modal's life. `extraRoot` is what makes the closing edge work: a modal is
 * closed by REMOVING its element, so by the time teardown runs the guest is inside a DETACHED subtree
 * and `document.querySelectorAll` can no longer see it. Passing the dying element as a second search
 * root recovers it — a detached node keeps its children, so the toast and its still-unread contents
 * come back to `<body>` alive.
 */
export function reseatTopLayerGuests(host: HTMLElement, extraRoot?: ParentNode | null): void {
    const guests = new Set<HTMLElement>(qsa<HTMLElement>(document, TOP_LAYER_GUEST))
    if (extraRoot) for (const guest of qsa<HTMLElement>(extraRoot, TOP_LAYER_GUEST)) guests.add(guest)

    for (const guest of guests) {
        if (guest === host || guest.contains(host)) continue
        if (guest.parentElement !== host) host.appendChild(guest)
        restackTopLayerGuest(guest)
    }
}

/**
 * Where a portalled floating panel belonging to `el` must be parented.
 *
 * WHY A PANEL IS PORTALLED AT ALL
 * Left inside its own wrapper, a panel is clipped by every scrolling or transformed ancestor between it
 * and the root — a grid cell, a modal body, the sidebar's own scroll region. `<body>` has none of those,
 * which is why both DropdownComponent and SelectComponent have always moved theirs there.
 *
 * WHY `<body>` IS NOT ALWAYS THE ANSWER
 * An element showing as a popover paints in the TOP LAYER, which no z-index in the normal layer can
 * reach. Measured (Chrome 390x844, dark, the real bundles, the sidebar's own dropup):
 * with `<aside id="sidebar" popover="auto">` open, `elementsFromPoint(195, 769)` — a point inside the
 * panel's own rect — returned `[#sidebar-scroll, #sidebar, .rg-dd-item, #tp-panel, .rg-dd-backdrop]`.
 * The panel computes `z-index: 500` (--rg-z-popover) and the rail computes 210, and the panel still
 * painted UNDER both the rail and the rail's `::backdrop`. In dark mode that scrim is `rgb(17 24 39 /
 * .8)`, so the panel did not vanish — it dimmed to 20% of itself, an unreadable dark rectangle. Removing
 * only the `popover` attribute from that same DOM reversed the order (`[.rg-dd-item, #tp-panel, …]`),
 * which is what identifies the top layer, and nothing else, as the cause.
 *
 * A second defect has the same cause: a panel under `<body>` is not a DOM descendant of the open
 * popover, so a tap on it is an OUTSIDE tap for light-dismiss and the UA closed the rail out from under
 * the still-open panel (measured: after a real click at (315, 769), `sidebar.matches(':popover-open')`
 * went false while the panel stayed visible, leaving an orphan sheet over the page).
 *
 * Re-parenting into the open popover fixes both at once, because popover NESTING is established by DOM
 * ancestry: the panel is inside the top-layer subtree, so it paints with it, and it is "inside" for
 * light-dismiss, so touching it no longer dismisses the host. Measured after the change: same rect
 * `{x: 0, y: 694.2, w: 390, h: 149.8}`, `elementsFromPoint(195, 769)` = `[.rg-dd-item, #tp-panel,
 * .rg-dd-backdrop]`, and the rail still open after a real click inside the panel.
 *
 * The alternative — `showPopover({source})`, which nests without moving the node — was measured working
 * in Chrome and REJECTED: where `source` is unsupported the plain `showPopover()` fallback light-
 * dismisses the ancestor the instant the panel opens (measured: rail open before, closed after), and the
 * target here is Safari 26, where support could not be measured. DOM ancestry needs no API at all.
 *
 * WHY THE OPEN STATE AND NOT JUST THE ATTRIBUTE
 * The rail carries `popover` unconditionally at every width (the server has no viewport to branch on —
 * see styles/layout/_sidebar.scss §1), and from 992px up it is a docked column that is never SHOWN as a
 * popover. A `<dialog>` in the markup is likewise only in the top layer once `showModal()` has run.
 * Testing the state rather than the attribute keeps the desktop target `<body>`, byte for byte the
 * behaviour that shipped before this helper existed. See `inTopLayer` for the per-mechanism test.
 *
 * INVARIANT THIS INTRODUCES — the open popover must not become a containing block for the panel.
 * The panel positions itself with `position: fixed` in viewport coordinates (core/anchor.ts), and a
 * `transform`, `filter`, `backdrop-filter`, `perspective`, `will-change` or `contain: paint` on the host
 * would re-resolve those coordinates against the host's box instead. Measured: adding a transform to the
 * rail collapsed the sheet's width from 390 to 239. Today every host is clean — checked on the rail's
 * whole ancestor chain, and `styles/layout/_page-chrome.scss` carries no transform/filter on
 * `.rg-pagechrome-menu`, `.rg-pagechrome-inline` or `.rg-topbar-detail` either. It is the same rule
 * `_sidebar.scss` §4 already writes for the PUSHED element, and it now applies to the popover hosts too.
 *
 * WHY IT WALKS INSTEAD OF TESTING ONLY THE NEAREST `[popover]`
 * Shell popovers NEST, and the inner one is not always the one that is showing. `.rg-pagechrome-menu`
 * and `.rg-pagechrome-inline` are each a real popover in exactly the width range where the other is
 * `display: contents` (runtime/page-chrome.ts, `PANEL`), so a host inside the outer box has a CLOSED
 * popover as its nearest ancestor at the width where the inner one is open. Stopping at the first match
 * would answer `<body>` there and put the panel straight back under the top layer. This is the same walk
 * `closestOpenPanel` already performs one module over, for the same reason. Measured: with
 * `.rg-pagechrome-inline` open at 1280px, a dropdown under the closed `.rg-pagechrome-menu` still
 * resolves to `<body>` — correct, because no OPEN popover contains it — while one inside the open box
 * resolves to that box.
 *
 * The walk terminates: every step restarts strictly ABOVE the previous match, and `closest()` returns
 * null at the document root.
 */
export function portalTarget(el: Element): HTMLElement {
    let from: Element | null = el
    while (from) {
        // Annotated, not inferred: `from` is re-assigned FROM this value, and TS refuses a control-flow
        // type that depends on itself (TS7022) unless one of the two is stated.
        const host: HTMLElement | null = from.closest<HTMLElement>(TOP_LAYER)
        if (!host) return document.body
        if (inTopLayer(host)) return host
        from = host.parentElement
    }
    return document.body
}

/**
 * The mark every node `portalTarget` re-homes must carry: "I am a floating layer that was PARENTED here
 * by the runtime; I am not content the author put in this box."
 *
 * WHY A STYLESHEET NEEDS THIS AT ALL. Since the panel stopped going to `<body>` unconditionally, its
 * parent can be any open top-layer host — and those hosts have layout rules for their own children.
 * `styles/layout/_page-chrome.scss` is the measured case: `.rg-pagechrome-inline:has(> * + *) > *` is the
 * MENU ROW rule, and a portalled panel became a menu row. Measured (Chrome 1280x800, real bundles, the
 * desktop overflow menu open with three actions, single variable = the panel's parent, same node moved
 * and moved back): under `<body>` `inline-size: 272.602px`; inside `.rg-pagechrome-inline`
 * `inline-size: 1280px` — the panel is `position: fixed`, so a `100%` inline size resolves against the
 * VIEWPORT, not against the flex parent, and the rect ran from x = 8 to x = 1298 on a 1280px viewport.
 * `justify-content` flipped `normal` → `flex-start` with it.
 *
 * WHY AN ATTRIBUTE AND NOT THE PANEL CLASSES THAT ALREADY EXIST (`.rg-dd-panel`, `.rg-select-panel`,
 * `.rg-dd-backdrop`). Three reasons, in order of weight:
 *   · Those names are the vocabulary of `forms/`. A rule in `layout/` that excluded them would be a
 *     layout file depending on the class list of two form components, and the list would have to be
 *     extended by hand for every floating layer added later — the failure being silent, because a
 *     forgotten class just quietly becomes a menu row again.
 *   · They answer the wrong question. A class says WHAT the node is; the host needs to know WHY it is
 *     here. "Re-parented by the runtime" is the predicate, it is true of the backdrop as well as of the
 *     panel, and it is stated at the one place the re-parenting happens.
 *   · One token also covers the element-COUNTING selectors in that file (`:has(> * + *)`,
 *     `:has(> :only-child)`), which a class list would have to repeat at every site.
 *
 * It is set ONCE, at mount, and never cleared: it describes the node's kind, not its current parent, so
 * it stays correct across the close/open re-homing and across the deliberate move back into the
 * component root on destroy and on `htmx:beforeHistorySave`.
 */
export const PORTAL_MARK = 'data-rg-portal'

/** Stamps {@link PORTAL_MARK} on a floating layer. Idempotent — remounts re-run it. */
export function markPortalled(node: Element): void {
    node.setAttribute(PORTAL_MARK, '')
}

/** CSS.escape with a fallback for the handful of engines that still lack it. */
export function cssEscape(value: string): string {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')
}

export function closest<T extends Element = HTMLElement>(target: EventTarget | null, selector: string): T | null {
    return target instanceof Element ? (target.closest(selector) as T | null) : null
}

export function qsa<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
    return [...root.querySelectorAll<T>(selector)]
}

/** Reads a JSON-ish value from localStorage, returning the fallback on absence or corruption. */
export function readStore<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key)
        return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
        return fallback
    }
}

export function writeStore(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value))
    } catch {
        /* private mode or quota exceeded — persistence is best-effort */
    }
}
