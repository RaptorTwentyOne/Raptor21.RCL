/**
 * The seven things `RaptorSidebar` cannot express declaratively.
 *
 * This replaces a 1010-line vendored menu script whose entire job was a five-way `data-toggled` state
 * machine on `<html>`. Open/closed, Esc, light-dismiss and focus return are now the native popover's,
 * and the mode is a server-rendered attribute read by CSS. What is left is below, and every listener
 * here has a reason it cannot be CSS.
 *
 * THE SCRIM IS NOT THE NATIVE ONE. `::backdrop` on a popover is not hit-testable — measured, Chrome
 * refuses `pointer-events` there even at `!important` — so the dismissal tap fell through to the page
 * and fired whatever control it landed on. The scrim is a DOM descendant of the rail instead
 * (_sidebar.scss §3c), and item 6 is what closes the drawer when it is touched.
 *
 * WHAT THE NATIVE POPOVER DOES NOT GIVE YOU IS FOCUS CONTAINMENT. `popover` is not `<dialog>.showModal()`:
 * it takes the top layer and paints a `::backdrop`, but Tab walks straight out of it into the page behind
 * the scrim. Measured at 500x667 with the drawer open: ten Tab steps stayed in the rail, the eleventh
 * landed on the topbar's actions button and the twelfth and thirteenth on page buttons at x=656 — off a
 * 500px viewport entirely, invisible behind the scrim. Worse, focus that has escaped also breaks the one
 * focus behaviour the UA DOES provide: Escape from an escaped focus closed the rail and left focus on the
 * page control, so it never came back to the hamburger. Item 5 fixes both with the SAME `FocusTrap` class
 * `ModalComponent` already uses (core/focus.ts) — a trap, not `inert`: `inert` on the content column stops
 * focus reaching the page but does not close the loop, and Tab off the rail's last item dropped to <body>
 * on three consecutive presses instead of wrapping.
 *
 * Document-level and installed once from `index.ts`, never through the component registry: `popovertarget`
 * is declarative, so the browser can open the rail before a lazily-loaded chunk resolves, and a close
 * handler that arrives after that would have a window in which the drawer opens and cannot be closed.
 * Document-level listeners are also indifferent to boosted swaps, history restores and `hx-preserve`.
 */

import {qsa, restackTopLayerGuest, TOP_LAYER_GUEST} from '../core/dom'
import {FocusTrap} from '../core/focus'
import {lockScroll, unlockScroll} from '../core/scroll-lock'

const RAIL = '.rg-sidebar[popover]'
const RAIL_TOGGLE = '[data-rg-sidebar-rail-toggle]'
const RAIL_SCRIM = '.rg-sidebar-scrim'
const DESKTOP = '(min-width: 992px)'

/** Suppresses the open/close transition for exactly one close — see item 1. Read back by
 *  `_sidebar.scss` (§3b/§4) at higher specificity than the rules that install the transition. */
const ANIM_OFF = 'data-rg-sidebar-anim'

/** Per-rail, not one variable: `RAIL` is plural by construction (`rails()`), and a rail carrying
 *  `hx-preserve` outlives every boosted swap, so the key has to be the node itself. */
const traps = new WeakMap<HTMLElement, FocusTrap>()

function rails(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(RAIL))
}

function close(rail: HTMLElement): void {
    // `hidePopover()` throws on an element that is not showing, and `:popover-open` is the only
    // reliable test — an element can carry the attribute and never have been opened.
    if (rail.matches(':popover-open')) rail.hidePopover()
}

export function installSidebar(): void {
    /* 1. Close the drawer when a navigation starts.
          The rail carries `hx-preserve`, so a boosted swap keeps the LIVE node — including its open
          popover state. Without this, tapping a nav link leaves the drawer covering the page it just
          navigated to. `htmx:beforeSwap` rather than a click handler on links: it also covers forms,
          `hx-get` buttons and programmatic navigation, and it is the moment the old page stops being
          the current one.

          THIS CLOSE IS NOT ANIMATED, AND THAT IS A MEASURED FIX RATHER THAN A PREFERENCE.
          Since the drawer got an entry/exit transition and Push started moving the whole shell, the
          two mechanisms collide exactly here: the rail and the consumer's persistent chrome are LIVE
          nodes that survive the swap, so they animate out over ~220ms — but `.content` is REPLACED by
          the response, and the replacement is parsed with the rail already closed, so it renders at
          `translate: none` immediately. Measured on the real app, tapping a rail link at 500x823
          (frame timestamps, the swap arriving 822ms after the click):
              …355171   rail=0    push=240  hdr=240  translate=240px     (drawer open, steady)
              beforeSwap@355183 / afterSwap@355246
               355267   rail=0    push=0    hdr=240  translate=none      <-- content SNAPPED
          i.e. the content jumped 240px in one frame while the bar was still 240px out and the rail was
          still fully on screen — the frame tearing apart, which is the complaint this whole round
          exists to fix, reproduced on the navigation path.

          Animating a drawer shut over a page that is being replaced buys nothing anyway, so the whole
          group is pinned to no-transition for this one close: all four movers jump to the closed state
          in the same frame the content does. The attribute goes on the RAIL, not on `<html>` — this
          library does not write to the consumer's root element (see the header of `_sidebar.scss`) —
          and `_sidebar.scss` reads it back with `html:has()` for the pushed elements, at higher
          specificity than the rules that install the transition.

          THE ATTRIBUTE IS CLEARED ON THE NEXT OPEN, NOT ON A TIMER — measured, after the timer version
          was written and failed. The first attempt cleared it from a double `requestAnimationFrame`,
          which is correct only while frames are being produced: `requestAnimationFrame` does not run in
          a backgrounded tab, so the callback never fired and the attribute stayed on the rail for good.
          Reproduced immediately — with the tab hidden, a rail opened long after the navigation reported
          `data-rg-sidebar-anim="off"` and `transition-duration: 0s/0s/0s` on rail, content and chrome,
          i.e. the drawer had silently lost its animation for the rest of the document's life.

          `beforetoggle` has none of that dependence: it is dispatched SYNCHRONOUSLY before the state
          flips, so removing the attribute on the way OPEN is guaranteed to land before the entry
          transition and `@starting-style` are evaluated, with no frame, timer or visibility assumption
          anywhere. A rail that sits closed carrying the attribute is harmless — a closed rail has no
          transition to suppress — so "clear it exactly when it would start to matter" is also the
          smallest correct rule. */
    document.addEventListener('htmx:beforeSwap', () => rails().forEach(rail => {
        if (!rail.matches(':popover-open')) return
        rail.setAttribute(ANIM_OFF, 'off')
        close(rail)
    }))

    document.addEventListener('beforetoggle', event => {
        const rail = event.target as HTMLElement | null
        if (!rail?.matches?.(RAIL)) return
        if ((event as ToggleEvent).newState === 'open') rail.removeAttribute(ANIM_OFF)
    }, true)  // capture: `beforetoggle` does not bubble

    /* 2. Body scroll lock while a drawer is open.
          A popover's `::backdrop` paints over the page but does not stop it scrolling, and a drawer
          that lets the page scroll behind it loses the reader's position. `toggle` is the popover's own
          event and fires for every path in and out — invoker, Esc, light-dismiss, `hidePopover()` — so
          there is no state to track here.

          BALANCED, not `resetScrollLock`. The lock is a shared counter (core/scroll-lock.ts) and the
          drawer is not the only thing that can hold it: the sales-org and user dropdowns live in this
          rail's own foot and go to sheet mode below 992px, taking a second lock (DropdownComponent.ts).
          Collapsing the counter here would drop THEIR lock too — the page would scroll behind a sheet
          that is still open, and that sheet's own `unlockScroll()` would then no-op against the
          already-zero guard, so the next lock would be unbalanced as well. `resetScrollLock` belongs to
          the one caller whose job is tearing the whole overlay layer down (runtime/page-lifecycle.ts),
          and that path is also what covers a rail removed while open — which cannot happen on a swap
          anyway, since the rail carries `hx-preserve` and keeps the live node.

          The two locks stay paired without either side knowing about the other. This handler releases
          the rail's; the dropdown releases its own from a `toggle` listener of its own that watches for
          an ancestor popover closing (DropdownComponent.mount). Both are capture-phase document
          listeners on the same event, so the rail's close runs one `unlockScroll()` per holder and the
          counter lands on zero — which is exactly why neither may be turned into a reset. */
    /* 5. Keep Tab inside an open mobile drawer, and hand focus back on close.
          Shares this listener rather than adding a second one: identical event, identical phase,
          identical `rail` resolution, and the two must not be able to disagree about which state the
          rail is in. `toggle` covers every path in and out for the same reason item 2 relies on it.

          MOBILE ONLY. At 992px and up the rail is docked chrome with no invoker at all (the consumer's
          FAB is `display: none` there) and item 4 already closes it on the way up, so trapping Tab in
          it would be trapping the user in the page's navigation. The guard is on the OPEN branch only;
          release is unconditional, so a rail that was trapped at 500px and then closed by item 4 at
          1000px still releases.

          NO DOUBLE FOCUS on the way out, and this is a real ordering question rather than an assumed
          one: `beforetoggle` is synchronous but `toggle` is ASYNCHRONOUS — measured, it arrives after
          `hidePopover()` has returned. The UA restores focus to the invoker INSIDE `hidePopover()`, so
          by the time `release()` runs, focus is already on the hamburger, `root.contains(active)` is
          false and `root.isConnected` is true — both clauses of `FocusTrap.shouldRestore()` (core/
          focus.ts) are false and the trap only unbinds its keydown listener. It does not fight the UA
          for the same element; it is there for the case the UA does not cover, which is focus that
          escaped to the page BEFORE the close. */
    document.addEventListener('toggle', event => {
        const rail = event.target as HTMLElement | null
        if (!rail?.matches?.(RAIL)) return
        if ((event as ToggleEvent).newState === 'open') {
            lockScroll()
            if (!window.matchMedia?.(DESKTOP)?.matches) {
                const trap = new FocusTrap(rail)
                traps.set(rail, trap)
                trap.activate()
            }
        } else {
            unlockScroll()
            traps.get(rail)?.release()
            traps.delete(rail)
        }
    }, true)  // capture: `toggle` does not bubble

    /* 3. Collapse/expand the desktop rail.
          Docked <-> Rail is a real user choice and CSS cannot hold state. It is written to
          `data-rg-sidebar-desktop` ON THE RAIL, which is the same attribute the server renders, so the
          stylesheet has exactly one selector for both origins. Not persisted, deliberately: the script
          this replaces did not persist it either (it re-derived the rail state on every full load and
          never stored it), and a cookie round-trip or a localStorage boot script would be a new
          contract — and a first-paint width flash — for a behaviour nobody has today. The rail sits
          inside `hx-preserve`, so the choice does survive every boosted navigation. */
    document.addEventListener('click', event => {
        const toggle = (event.target as Element | null)?.closest?.<HTMLElement>(RAIL_TOGGLE)
        if (!toggle) return
        const rail = toggle.closest<HTMLElement>(RAIL)
        if (!rail) return
        const collapsed = rail.getAttribute('data-rg-sidebar-desktop') === 'rail'
        rail.setAttribute('data-rg-sidebar-desktop', collapsed ? 'docked' : 'rail')
        toggle.setAttribute('aria-expanded', collapsed ? 'true' : 'false')
    })

    /* 4. Close an open drawer when the viewport crosses into the desktop band.
          Geometry is already correct there (the UA neutralisation applies at every width) and the
          scrim is removed by CSS, so this is not a correctness fix — but an element left in the top
          layer paints above modals until the next navigation, and nothing else would take it out. */
    window.matchMedia?.(DESKTOP)?.addEventListener('change', event => {
        if (event.matches) rails().forEach(close)
    })

    /* 6. Close the drawer when its scrim is touched.
          EXPLICIT, NOT OPTIONAL. The scrim is a DOM DESCENDANT of the rail (RaptorSidebar.razor, and
          _sidebar.scss §3c for why it cannot be `::backdrop`), which is exactly what stops the tap
          reaching the page underneath — and it is also what stops the UA's light-dismiss from firing,
          because a tap inside the popover's subtree is an INSIDE tap. Measured with the handler absent:
          the `SCRIM-CLICK` arrived and `rail.matches(':popover-open')` was still true.

          `closest` and not `event.target === scrim`: the scrim has no children today, but a consumer
          themeing it with an inner element must not silently lose the dismissal. */
    document.addEventListener('click', event => {
        const scrim = (event.target as Element | null)?.closest?.<HTMLElement>(RAIL_SCRIM)
        if (!scrim) return
        const rail = scrim.closest<HTMLElement>(RAIL)
        if (rail) close(rail)
    })

    /* 7. Keep the always-on surfaces on top when something else enters the top layer.
          Order in the top layer is the order things were SHOWN, and z-index cannot reach across it —
          measured, a `<body>` child at z-index 2147483647 still sat under an open rail. So a toast that
          was already on screen when the drawer opens ends up BEHIND it (measured:
          `[#sidebar-scroll, #sidebar, #probe-manual3]`), and its close button with it.

          `hidePopover()` + `showPopover()` on the guest re-stacks it to the top and leaves the rail OPEN
          (measured: `[#probe-manual3, #sidebar-scroll, #sidebar]`, `railStillOpen: true`) — a `manual`
          popover neither dismisses nor is dismissed by an `auto` one.

          Document-level and generic rather than a rail-specific hook: any surface entering the top layer
          creates the same problem, and the guests do not know who displaced them. Guests are skipped as
          triggers so the re-stack cannot re-enter itself; a modal `<dialog>` never reaches here (it
          fires `close`, not `toggle`) because ModalComponent adopts the guests into itself instead.

          `[popover]` IS PART OF THE TEST, NOT TIDYING-UP. `toggle` is not the popover's event: `<details>`
          fires the same one, with the same `ToggleEvent` shape — measured, opening a `<details>` on
          /roles gave `{ctor: 'ToggleEvent', oldState: 'open', newState: 'closed', isTrusted: true}` on
          the way back out, i.e. indistinguishable here from a popover. And `FilterPanelComponent` builds
          one `<details>` per filter section, so without this line every section a user expands ran
          `hidePopover()` + `showPopover()` over the whole toast stack. Measured before the guard, with a
          toast on screen: opening ONE `<details>` produced two `toggle` events on
          `#app-notification-container` — the stack taken out of the top layer and put back — for an
          element that never entered the top layer at all. Nothing visible went wrong, and nothing was
          guaranteed not to: a re-stack is a real state change on a live surface (it re-runs the popover
          open path, and `showPopover()` on a disconnected node throws into the catch in
          `restackTopLayerGuest`), driven by an event that has nothing to do with the top layer.
          `DropdownComponent` and `SelectComponent` already carry the same guard, for the same reason,
          on their own `toggle` listeners. */
    document.addEventListener('toggle', event => {
        const host = event.target
        if (!(host instanceof HTMLElement)) return
        if ((event as ToggleEvent).newState !== 'open') return
        if (!host.hasAttribute('popover')) return
        if (host.matches(TOP_LAYER_GUEST)) return
        for (const guest of qsa<HTMLElement>(document, TOP_LAYER_GUEST)) restackTopLayerGuest(guest)
    }, true)  // capture: `toggle` does not bubble
}
