/**
 * The two pieces of behaviour `RaptorPageChrome` cannot express declaratively.
 *
 * WHY THIS IS DOCUMENT-LEVEL AND NOT A REGISTERED COMPONENT
 * The registry loads a component's chunk lazily, on mount. `popovertarget` is declarative: the browser
 * opens the menu the moment it is clicked, chunk or no chunk. A lazily-installed close handler would
 * therefore have a window — first paint until the chunk resolves — in which the menu opens and never
 * closes. Document-level listeners installed from the entry bundle have no such window, and they are
 * also indifferent to swaps, restores and mounts, which is what the projector below needs anyway.
 *
 * Everything here is idempotent and installed exactly once (`index.ts`).
 */

import {isPageRegion, PAGE_LOAD_EVENT} from './page-lifecycle'

/** The host's persistent mobile-bar container. Emitted by `RaptorPageChromeOutlet`. */
const TOPBAR_SLOT = 'rg-topbar-slot'

/** The inert payload the page emits inside `#app-root`. Mirrors `RaptorPageChrome.TopbarPayloadElementId`. */
const TOPBAR_PAYLOAD = 'rg-topbar-payload'

/**
 * The payload's identifying node — and the only node either stylesheet guard tests for.
 *
 * Deliberately NOT `:empty`: shipping browsers do not treat a whitespace text node as empty, and the
 * server emits a newline around the payload, so an `:empty` test would silently invert.
 */
const TOPBAR_TITLE = '.rg-topbar-title'

/**
 * Every popover the page shell owns inside `#app-root`, and they NEST.
 *
 * `.rg-pagechrome-menu` is the outer control box — the tools box and the actions box together — and it is
 * the popover the persistent bar's "…" opens below 992px. `.rg-pagechrome-inline` is the desktop overflow
 * menu, a DOM descendant of it. Each is a real popover in exactly the width range where the other is
 * `display: contents`, so at any given moment only one of the two can be open — but a click inside the
 * open one always resolves to the INNER element first, which is why nothing below may use a bare
 * `closest(PANEL)`.
 */
const PANEL = '.rg-pagechrome-inline[popover], .rg-pagechrome-menu[popover]'

/**
 * The bar's copy of the "…" trigger.
 *
 * Not built here. It is part of the payload the server renders, so it rides the SAME `<template>` — and
 * therefore the same single `replaceChildren` — as the title: it can never be written a frame late, and
 * it can never be left behind on a page that projects nothing. Building it in script would also mean
 * shipping its accessible name to the client, which the resource files already own on the server.
 *
 * What the projector still owns about it is the invariant below: the button is only meaningful while the
 * panel it names is in the document.
 */
const BAR_TRIGGER = '.rg-topbar-actions'

/**
 * The bar's full-text panel and the two clipped lines it exists for (U2/U3).
 *
 * Both lines are one-line-with-ellipsis in the bar, because a bar whose height varied with the length of
 * a runtime string would be a per-page layout shift. The panel carries the same two strings in full.
 *
 * The panel is server-rendered as part of the payload; only the TRIGGER around the title text is built
 * here, and only when a measurement says one is warranted — see `syncTitleTrigger`.
 */
const TITLE_TEXT = '.rg-topbar-titletext'
const TITLE_DESC = '.rg-topbar-desc'
const TITLE_TRIGGER = '.rg-topbar-titlebtn'
const DETAIL = '.rg-topbar-detail'

/** Every popover this module owns. The `toggle` contract below is the same for all of them. */
const POPOVERS = `${PANEL}, ${DETAIL}[popover]`

/**
 * What counts as "the user activated something in the menu".
 *
 * Broad on purpose. The actions inside a panel belong to four different runtimes — htmx attributes,
 * document-delegated export buttons, plain links, and id-bound scripts in the host app — and none of
 * them emits a common event. The element type is the only thing they share.
 */
const ACTIVATORS = 'a[href], button, input[type="submit"], input[type="button"], [role="button"]'

/** Focusable descendants in tree order. Mirrors `core/focus.ts`; not imported from it, because that
 * module also carries the focus trap and this one must stay in the entry bundle. */
const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Whether this browser has the popover API at all.
 *
 * Guards every `:popover-open` test below: `matches(':popover-open')` THROWS a SyntaxError on an
 * engine that does not know the selector, which would take out the click handler for the whole
 * document — including pages that never render a page shell.
 */
const HAS_POPOVER = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype

function isOpen(panel: Element): boolean {
    return HAS_POPOVER && panel.matches(':popover-open')
}

function firstFocusable(root: ParentNode): HTMLElement | null {
    return root.querySelector<HTMLElement>(FOCUSABLE)
}

/**
 * The nearest OPEN shell popover at or above `el`, or null.
 *
 * `closest(PANEL)` alone is not enough since the panels nest (see PANEL). Below 992px the actions panel is
 * flattened to `display: contents` INSIDE the open menu, so a tap on an action matches that flattened
 * element first, `isOpen` says no — it is not the popover that is open — and a bare `closest` would return
 * there and leave the menu standing over the page it just acted on. Walking on from the match's PARENT is
 * what finds the box that really is open; on desktop the first match is already it, so this is one extra
 * `matches()` on the path that used to work.
 *
 * The walk is bounded by the panel chain: each step starts strictly above the previous match, and the last
 * `closest()` returns null at the document root.
 */
function closestOpenPanel(el: Element): HTMLElement | null {
    let from: Element | null = el
    while (from) {
        // Annotated, not inferred: `from` is re-assigned FROM this value further down, and TS refuses to
        // resolve a control-flow type that depends on itself (TS7022) unless one of the two is stated.
        const panel: HTMLElement | null = from.closest(PANEL)
        if (!panel) return null
        if (isOpen(panel)) return panel
        from = panel.parentElement
    }
    return null
}

/**
 * Identity of whatever bar payload lives under `root`, or '' when there is none.
 *
 * Read from the payload's own title node rather than from an attribute on the slot, so the server path
 * and the client path agree without the outlet — rendered by the host's layout, possibly on a page that
 * has no page shell at all — having to know the current page's key. On a full document load the slot
 * already holds the server-rendered payload and its key equals the template's, so `projectTopbar` does
 * nothing and first paint is never touched by script.
 */
function payloadKey(root: ParentNode | null): string {
    return root?.querySelector<HTMLElement>(TOPBAR_TITLE)?.dataset.rgTopbarKey ?? ''
}

/**
 * Projects the current page's bar payload into the persistent bar — and EMPTIES the bar when the page
 * has none.
 *
 * The emptying half is the point, not an edge case. Pages that do not use the shell (a detail page a
 * grid drills into, an error page, a login page, anything not yet migrated) emit no template; without
 * this, the bar would keep showing the title of the page the user came FROM, indefinitely, because
 * nothing else ever writes to it.
 *
 * `replaceChildren` is called ONCE, with the clone already built. An "empty, then fill" pair would put
 * the document through a frame in which `.rg-topbar-title` does not exist, and the stylesheet guards
 * keyed on that node would flip the in-page heading visible and back — a visible flash on every
 * navigation. This atomicity is a behaviour to preserve, not an accident of how it is written today.
 *
 * `cloneNode` and not `appendChild(tpl.content)`: appending MOVES the fragment's nodes and leaves the
 * template empty, which would then be snapshotted empty and restore an empty bar on Back.
 */
function projectTopbar(): void {
    const slot = document.getElementById(TOPBAR_SLOT)
    if (!slot) return // no outlet on this layout — nothing to project into

    const tpl = document.getElementById(TOPBAR_PAYLOAD) as HTMLTemplateElement | null
    const next = tpl?.content ?? null

    // Same payload already in place — but the TRIGGER below is a measurement, not part of the payload,
    // so it is re-evaluated either way. This is the path a full document load takes (the server already
    // wrote the bar and the keys match), and it is exactly the path on which the title has never been
    // measured yet.
    if (payloadKey(slot) !== payloadKey(next)) {
        slot.replaceChildren(...(next ? [next.cloneNode(true)] : []))
        dropDanglingTrigger(slot)
    }

    syncTitleTrigger(slot)
}

/**
 * Whether an element's text is actually clipped by its own `text-overflow: ellipsis`.
 *
 * The 1px slack absorbs sub-pixel layout: at fractional zoom / non-integer DPR a line that fits exactly
 * still reports scrollWidth one physical pixel wider than clientWidth, and without the slack the bar
 * would sprout a trigger for a title that is plainly not truncated.
 */
function overflows(el: Element | null): boolean {
    return !!el && el.scrollWidth - el.clientWidth > 1
}

/**
 * U3 — makes the bar's title a popover trigger IF, AND ONLY IF, something in the block is really clipped.
 *
 * WHY THE TRIGGER IS BUILT HERE AND NOT BY THE SERVER
 * Whether 30-odd characters fit is a function of the viewport, the font that actually loaded and the
 * width the host's fixed hamburger leaves behind. The server knows none of the three. Rendering the
 * button unconditionally and disabling it when unused was the alternative and is worse in the way this
 * codebase already refuses elsewhere: it leaves a focusable control on screen that does nothing. Here a
 * title that fits produces NO button — no tab stop, no `aria-expanded`, no pointer affordance — and the
 * heading is a plain heading again.
 *
 * WHY IT IS REVERSIBLE
 * `wrap` and `unwrap` are exact inverses over the same nodes, so rotating a phone (or the host's mobile
 * shell being resized past the point where the title fits) moves between the two states as many times as
 * it likes. Nothing is cloned and no text is rewritten, so the title node the payload key rides on is
 * untouched by all of it.
 *
 * WHY IT CANNOT OSCILLATE
 * The measurement is taken on `.rg-topbar-titletext`, and `.rg-topbar-titlebtn` is styled `display:
 * block; inline-size: 100%` with ZERO inline padding and no border (`_page-chrome.scss`). Wrapping the
 * span therefore leaves its containing block exactly as wide as it was, so `scrollWidth`/`clientWidth`
 * read the same before and after — the state this function computes is a fixed point of the change it
 * makes. Do not give that button inline padding or a border.
 */
function syncTitleTrigger(slot: Element | null): void {
    const host = slot ?? document.getElementById(TOPBAR_SLOT)
    if (!host) return

    const text = host.querySelector<HTMLElement>(TITLE_TEXT)
    const panel = host.querySelector<HTMLElement>(DETAIL)
    const trigger = host.querySelector<HTMLElement>(TITLE_TRIGGER)

    // No title, or a payload with no panel to open: whatever is there must not be a trigger.
    if (!text || !panel?.id) {
        if (trigger) unwrapTitleTrigger(trigger)
        return
    }

    const wanted = overflows(text) || overflows(host.querySelector(TITLE_DESC))
    if (wanted === !!trigger) return

    if (wanted) wrapTitleTrigger(text, panel.id)
    else if (trigger) unwrapTitleTrigger(trigger)
}

/**
 * Wraps the title text in the button that opens the full-text panel.
 *
 * `popovertarget` rather than a click listener: it is declarative, so the panel opens, light-dismisses
 * and closes on Escape with no further script — the same reason the actions menu uses one. The invoker
 * is a real, visible control, which is what makes the UA restore focus to it when the panel closes.
 *
 * No accessible name is written: the button's content IS the title, so its name is the title, and the
 * <h1> that now contains the button keeps exactly the accessible name it had before. That is also why
 * nothing localised has to reach the client for this.
 */
function wrapTitleTrigger(text: HTMLElement, panelId: string): void {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'rg-topbar-titlebtn'
    button.setAttribute('popovertarget', panelId)
    button.setAttribute('popovertargetaction', 'toggle')
    button.setAttribute('aria-controls', panelId)
    button.setAttribute('aria-expanded', 'false')

    text.replaceWith(button)
    button.appendChild(text)
}

/** The exact inverse: the text goes back to being a direct child of the heading. */
function unwrapTitleTrigger(trigger: HTMLElement): void {
    trigger.replaceWith(...trigger.childNodes)
}

/**
 * Removes the bar's "…" when the panel it points at is not in the document.
 *
 * The button's whole behaviour is `popovertarget`, which is resolved against the document by id — that
 * is what lets the panel and every action node stay inside `#app-root` while only the invoker travels to
 * the persistent bar. The flip side is that a `popovertarget` naming a missing id is silently inert: the
 * user would get a button that visibly does nothing.
 *
 * The payload key makes that state unreachable on every path we know of (the id is part of the key, so a
 * new panel always forces a re-projection), which is exactly why this is a cheap assertion rather than
 * the mechanism. It costs one `getElementById` per navigation and it converts an invisible dead control
 * into no control at all.
 *
 * `getElementById` does NOT see the copy inside `<template id="rg-topbar-payload">`: template content is
 * an inert fragment outside the document tree, so the only match it can find is the live panel.
 */
function dropDanglingTrigger(slot: Element): void {
    const trigger = slot.querySelector<HTMLElement>(BAR_TRIGGER)
    if (!trigger) return

    const id = trigger.getAttribute('popovertarget')
    if (!id || !document.getElementById(id)) trigger.remove()
}

export function installPageChrome(): void {
    // ---------------------------------------------------------------------------------------------
    // Menu: an activation inside the panel closes it.
    //
    // HTML popovers light-dismiss on a click OUTSIDE only; activating a control INSIDE one leaves it
    // open. That is not cosmetic: an open popover paints in the top layer, above the entire document
    // regardless of z-index, so a menu left standing covers the result of the very action it was used
    // for — a navigated page, a re-rendered grid, a drawer.
    //
    // THE MODAL CASE IS NO LONGER PART OF THAT ARGUMENT, and the old note here said it was. It claimed
    // this library's modal was "an ordinary fixed <div>, not dialog.showModal()", and that a menu left
    // open would cover it and then be marked inert by the modal's own inert-below pass. Both halves are
    // gone: every `.rg-modal` is a native `<dialog>` opened with `showModal()` (modal/open.ts), there is
    // no inert-below pass anywhere in the library, and the UA closes every open `auto` popover as part
    // of going modal. Measured (Chrome 150, real bundles, /roles at 386px): with the bar's "…" menu open
    // (`:popover-open` true, rect x = 149) a `.rg-modal` was opened over it — `menu.matches(':popover-
    // open')` was false immediately afterwards, with no help from this listener. What is left is the
    // reason above, which applies to every activation and not just to the ones that open a dialog.
    //
    // Delegation rather than `popovertargetaction="hide"` on each item: that attribute is ignored on
    // <a>, and the slot is transparent, so the shell cannot know what element type an action is.
    //
    // It cannot break the action it closes over. The listener neither prevents default nor stops
    // propagation, and an event's propagation path is computed before dispatch — hiding the panel
    // mid-flight does not unregister anything on the path, and the node is neither moved nor removed,
    // so `closest()` in every other handler still resolves.
    document.addEventListener('click', event => {
        const target = event.target
        if (!(target instanceof Element)) return

        const panel = closestOpenPanel(target) // null unless one is really open — hidePopover() throws on a closed popover
        if (!panel) return

        const activator = target.closest(ACTIVATORS)
        // `[data-rg-keep-open]` is the escape hatch for a multi-step control inside the panel: a filter
        // form, a column chooser, anything the user WORKS IN rather than picks from. The test is a plain
        // ancestor walk, which is all it can be — the host has no idea which runtime built the control.
        //
        // THE WALK ONLY WORKS BECAUSE THE MARKED NODE TRAVELS. `RaptorDropdown` authors the attribute on
        // its ROOT, and since `portalTarget` the panel is re-parented out of that root and into THIS
        // popover — so from a button inside the panel, `closest()` passes the popover and reaches the
        // document without ever seeing the root. Measured (Chrome, real trusted clicks, both 1280x800
        // and 390x844): `btn.closest('[data-rg-keep-open]')` === null while the root carried the
        // attribute and `root.contains(btn)` was false; the menu closed on every activation, so a
        // keep-open panel behaved exactly like one without the flag. `DropdownComponent.mount()` now
        // MIRRORS the attribute onto the panel, which is the node that moves, and this line is unchanged
        // because it was never the half that was wrong.
        if (!activator || !panel.contains(activator) || activator.closest('[data-rg-keep-open]')) return

        // A DROPDOWN TRIGGER IS NOT AN ACTIVATION. It commits nothing; it opens a second layer that has
        // to live INSIDE this one. `ACTIVATORS` matches it only because it is a `<button>`, which is the
        // whole point of that selector being broad — this is the one member of it that must be excluded.
        //
        // Measured, before this line existed (Chrome 390x844, the real bundles, the "Upload Media"
        // dropdown of ProductsPage.razor:77 inside the phone "…" menu): tapping the trigger logged
        // `open dd-tools` → `close dd-tools` → `toggle pc-menu closed` in that order, and NOTHING was
        // left on screen. The dropdown's panel now re-homes into whichever popover is showing
        // (core/dom.ts `portalTarget`), so hiding the menu takes the panel's whole subtree with it and
        // DropdownComponent's ancestor-close listener correctly closes the dropdown it just opened.
        //
        // Before the portal change the same tap left the sheet standing under `<body>` — visible only
        // because there was no longer a top layer above it, which is the very stacking accident being
        // fixed. Keeping the menu open is the behaviour that survives both: the nested panel paints in
        // the menu's own top-layer subtree, and choosing an ITEM inside it still reaches this listener
        // (the item is a button inside the open menu) and closes both layers at once.
        if (activator.closest('[data-rg-dropdown-trigger]')) return

        panel.hidePopover()
    })

    // A <form> in the actions slot is legal (the slot is transparent) even though the API steers forms
    // towards `Tools`; submitting one has to close the menu for the same reason a click does. And on a
    // phone `Tools` itself is INSIDE the menu, so the header's own filter forms — the ones the API steers
    // there — now reach this listener too. That is the wanted behaviour: a submitted filter has done its
    // job and the panel is covering the result.
    document.addEventListener('submit', event => {
        const target = event.target
        if (!(target instanceof Element)) return
        closestOpenPanel(target)?.hidePopover()
    })

    // ---------------------------------------------------------------------------------------------
    // Focus and state contract.
    //
    // capture:true is REQUIRED — `toggle` does not bubble, so a listener on the document only ever sees
    // it during the capture phase.
    //
    // Moving focus into the panel on open is what makes the UA's own focus restoration fire on Escape
    // and on light-dismiss: the spec restores focus to the invoker only when focus was inside the
    // popover. Without this, Escape would drop the user at the top of the document.
    //
    // `aria-expanded` is written explicitly rather than left to whatever a UA may or may not infer from
    // `popovertarget`, so nothing depends on an implicit mapping being announced.
    //
    // DOCUMENT-WIDE, not `panel.parentElement`. The bar's "…" is outside `#app-root` and therefore not a
    // relative of the box it opens at all — that is the whole mechanism (`popovertarget` resolves against
    // the document, so the controls never move). Scoping the lookup to the panel's parent would leave the
    // button the user actually pressed announcing "collapsed" while its menu is open. The query is written
    // as a set rather than a single lookup because it costs nothing and does not care how many invokers a
    // given panel has: today the bar's button names the outer control box and the header's "…" names the
    // actions panel nested inside it, one each, live in disjoint width ranges.
    //
    // The bar's full-text panel (U3) is held to the SAME contract, which is why the selector is the
    // union. It contains nothing focusable by design, so `firstFocusable() ?? panel` lands on the panel
    // itself (`tabindex="-1"`) — enough for the spec's "focus was inside the popover" test, so Escape and
    // a tap outside return focus to the title the user pressed rather than to the top of the document.
    document.addEventListener('toggle', event => {
        const panel = event.target
        if (!(panel instanceof HTMLElement) || !panel.matches(POPOVERS)) return

        const open = (event as Event & { newState?: string }).newState === 'open'
        for (const trigger of document.querySelectorAll(`[popovertarget="${CSS.escape(panel.id)}"]`)) {
            trigger.setAttribute('aria-expanded', String(open))
        }

        if (open) (firstFocusable(panel) ?? panel).focus()
    }, true)

    // ---------------------------------------------------------------------------------------------
    // Bar projection. Three entry points, because each covers a path the others do not, and the key
    // comparison makes whichever runs second a no-op:
    //   afterSwap        — boosted navigation, dispatched in the same synchronous block as the swap, so
    //                      no frame is painted with the previous page's title.
    //   historyRestore   — Back/Forward, both the cache hit (no request at all) and the cache miss.
    //   raptor:page-load — first load, bfcache resurrection, and any consumer-driven restore.
    document.addEventListener('htmx:afterSwap', event => {
        if (isPageRegion(event.target)) projectTopbar()
    })
    document.addEventListener('htmx:historyRestore', projectTopbar)
    document.addEventListener(PAGE_LOAD_EVENT, projectTopbar)

    // ---------------------------------------------------------------------------------------------
    // Re-measure the title when the box it has to fit in changes.
    //
    // The width available to the title is the viewport minus the two reserved side columns, so it moves
    // on rotation and on a desktop window drag through the host's mobile breakpoint — and a title that
    // fitted in landscape is routinely clipped in portrait. Without this the phone would rotate into a
    // truncated title with no way to read it, or out of one into a trigger that no longer has a job.
    //
    // `resize` fires constantly on mobile Safari (the URL bar collapsing changes the visual viewport),
    // so the work is coalesced to one animation frame. That is affordable because `syncTitleTrigger` is
    // two `scrollWidth` reads and an early return in every steady state; nothing is written unless the
    // clipped/not-clipped answer actually flipped.
    //
    // NOT a ResizeObserver: an observer on the slot would fire on the box changes this function's own
    // wrap/unwrap can produce, and would have to be defended against re-entry. `resize` is caused only
    // by the user.
    let pending = 0
    const remeasure = () => {
        if (pending) return
        pending = requestAnimationFrame(() => {
            pending = 0
            syncTitleTrigger(null)
        })
    }
    window.addEventListener('resize', remeasure)
    window.addEventListener('orientationchange', remeasure)

    // …and once more when the web fonts have actually arrived. The first measurement runs against the
    // fallback font, and a title that fits in the fallback routinely does not fit in the real one (and
    // vice versa) — a wrong answer there is a bar with a visibly clipped title and nothing to tap, which
    // is the whole defect this feature exists to fix. One extra pass, on a promise that is already
    // resolved by the time any later navigation projects a new payload.
    //
    // Optional-chained: `document.fonts` is absent in a few embedded WebViews, and this must not be the
    // line that takes the entry bundle down on them.
    document.fonts?.ready.then(() => syncTitleTrigger(null))
}
