import { GridFeature } from '../GridFeature'
import { closest, qsa } from '../../core/dom'
import { lockScroll, unlockScroll } from '../../core/scroll-lock'
import { PAGE_LOAD_EVENT } from '../../runtime/page-lifecycle'

/**
 * How many whole-page loads this document has seen.
 *
 * Module state outlives not just the component but the page: a boosted navigation swaps `#app-root`
 * and re-mounts every component without ever re-parsing the bundle. So the memory below needs a page
 * identity, and this counter is it — anything remembered under an earlier epoch belongs to a page the
 * user has already left.
 *
 * A counter rather than clearing the memory on page-load, because mounting is asynchronous (the grid
 * arrives as a lazily-imported chunk) and the two are not ordered against each other. A clear that
 * landed after a drawer had already restored itself would not take the class back off; comparing
 * epochs gives the same answer whichever of the two runs first.
 */
let pageEpoch = 0
document.addEventListener(PAGE_LOAD_EVENT, () => {
    pageEpoch++
})

/**
 * Grid ids whose drawer is currently open, against the page epoch it was opened in.
 *
 * Outlives the component. Applying a filter swaps the whole region, which destroys this feature and
 * mounts a fresh one against the new markup, so an instance field would start empty every time and the
 * drawer would snap shut after each filter the user set. The grid id is the only identity that survives
 * the swap, so membership is keyed by it.
 *
 * The epoch narrows that memory to the page the drawer was opened on. Without it a drawer left open on
 * /customers was re-opened by the next visit to /customers — including a back/forward restore — which
 * the user saw as the filter panel being open on first paint and then disappearing.
 */
const openFilterGrids = new Map<string, number>()

/** The one htmx call this feature makes; htmx is a global script, not an import. */
interface HtmxTrigger {
    trigger(el: Element, name: string): void
}

/**
 * The card-mode filter drawer, and the floating button that opens it.
 *
 * In card mode the column headers — and with them the funnel buttons that open each filter popup — are
 * not on screen, so the server re-uses those same `.rg-pop` elements by stacking them inside a
 * right-hand drawer that a floating action button opens.
 *
 * BOTH SURFACES ARE IN THE TOP LAYER, AND THAT IS WHAT THIS CLASS IS MOSTLY FOR. Neither can be left as
 * an ordinary `position: fixed` box, because both live inside the consumer's pushed content column and
 * RaptorSidebar's Push mode puts a `translate` on it — which makes that column the containing block for
 * every fixed descendant. Measured on /roles at 500x823 (pushed box [0,56,495,723]):
 *
 *     FAB     at rest [395,663,84,44]      first frame of the rail opening [395.2,719]
 *             i.e. 56px DOWN in one frame, before any horizontal movement had started
 *     drawer  open    [140,0,360,723]      with the rail opened under it [375,56,360,2519]
 *             i.e. height 723 -> 2519 and the right edge at 735 on a 500px viewport
 *
 * So the drawer is `popover="auto"` (Escape, and a viewport containing block, from the user agent) and
 * the FAB is `popover="manual"`, shown here and never hidden — `manual` because an `auto` FAB would be
 * light-dismissed by the first tap anywhere and would close when the drawer, itself `auto`, opened.
 *
 * What is left for this class: showing the FAB, opening the drawer (the openers are not all inside the
 * region, so `popovertarget` cannot express it), the page scroll lock, carrying an open drawer across a
 * region swap, and clearing every filter at once.
 */
export class MobileFilterDrawer extends GridFeature {
    /**
     * Whether this instance is holding a page scroll lock — a ledger paired 1:1 with `lockScroll`/
     * `unlockScroll`, and deliberately NOT read back off the drawer's own state.
     *
     * They agree in ordinary use, so the popover's `:popover-open` looks sufficient. What that costs:
     * a drawer destroyed mid-swap leaves the top layer without firing anything this instance can pair
     * a release against, so the ledger is what `onDestroy` consults. Kept apart, the ledger answers
     * only for the counter in `core/scroll-lock` and the popover answers for the UI, so neither can
     * silently speak for the other.
     */
    private locked = false

    override init(): void {
        // ORDER MATTERS AND IT IS THE ONLY ORDERING RULE IN THIS FILE. The top layer is ordered by the
        // order things were SHOWN, so the FAB has to enter it BEFORE the drawer or it would paint over
        // the drawer's own scrim for the rest of the drawer's life.
        this.showFab()

        const drawer = this.drawer()
        if (drawer) {
            // `toggle` does not bubble, so it is bound to the drawer itself rather than to the region.
            // It is the popover's own event and fires for every path in and out — an opener, Escape,
            // the scrim, `hidePopover()` — which is why there is no open/closed field here at all.
            this.grid.track(drawer, 'toggle', event => this.onToggle(event as ToggleEvent))
        }

        // The swap re-mounts the component, so init is the first moment the new markup exists and an
        // open drawer can be put back. The drawer is a full-screen overlay on the phones it appears on,
        // so a lock taken by the instance this one replaces must be re-taken here too — which the
        // `toggle` handler above does, since re-showing the popover fires it.
        const gridId = this.grid.gridId
        if (gridId && openFilterGrids.has(gridId)) {
            if (openFilterGrids.get(gridId) === pageEpoch) this.restoreOpen()
            // A stale entry (opened on a page the user has since navigated away from) is dropped rather
            // than left to accumulate; the drawer stays shut, which is what the server rendered.
            else openFilterGrids.delete(gridId)
        }

        // DOCUMENT, not the region. The opener is allowed to live outside the grid — the page shell's "…"
        // menu is the supported second home for it (`RaptorGridFilterEntry.PageChrome`), and that menu is
        // a sibling of the grid, so a click on it never bubbles through the region. Everything else this
        // handler answers to is still inside the region and still checked with `isOwn`.
        //
        // Teardown is unchanged: `onDocument` goes through the same binding list as `on` (see
        // `core/Component.bind`), so the swap that destroys this feature removes the listener with it.
        this.onDocument('click', event => this.onClick(event))

        // A region can be destroyed while its drawer is open (a swap mid-filter, the grid's container
        // navigating away); the lock this instance took must not outlive it. If the drawer is staying
        // open across the swap, the replacement instance's restore takes its own lock.
        this.onDestroy(() => this.unlock())
    }

    /* THE `htmx:afterSettle` CLASS RE-ASSERT IS GONE FROM `init`, AND ITS ABSENCE IS THE POINT.

       The open state used to be two classes on the REGION ROOT, and htmx puts a swapped element's
       `class` attribute back to the server's value as a settle task 20ms later — so the drawer the user
       had open silently vanished on every filter keystroke while its scroll lock stayed held, and a
       whole listener existed to write the classes back. The state is the popover's now: `:popover-open`
       is not an attribute, htmx cannot settle it, and the only class this file still writes
       (`rg-no-anim`) is transient and lives on the drawer rather than on the region. */

    /** This grid's drawer — the `popover="auto"` shell, not the panel that slides inside it. */
    private drawer(): HTMLElement | null {
        return this.ownElement('.rg-filter-drawer')
    }

    /**
     * Puts the FAB in the top layer, where its `position: fixed` resolves against the viewport.
     *
     * Guarded three ways, and each guard is a real case rather than defensive noise:
     *  - no `popover` attribute: an older server render, or a browser without the API, in which case
     *    the card-mode `display: inline-flex` keeps the button visible and merely fixed the old way;
     *  - inside `.rg-detail`: a grid nested in a master-detail panel renders a FAB that is never
     *    painted (`display: none !important`), and an invisible element has no business in the top
     *    layer at all;
     *  - `showPopover()` throws on an element that is already showing or is disconnected, and both can
     *    happen when a swap and a mount race.
     */
    private showFab(): void {
        const fab = this.ownElement('.rg-filter-fab')
        if (!fab?.hasAttribute('popover')) return
        if (fab.closest('.rg-detail')) return
        try {
            fab.showPopover()
        } catch {
            /* already showing, or the node was replaced under us — the next mount re-shows it */
        }
    }

    /**
     * The one place the lock, the cross-swap memory and the openers' `aria-expanded` are written.
     *
     * Every path in and out reaches here, so none of them can disagree: the FAB, the page shell's menu
     * button, Escape, the scrim, Done, and the `showPopover()` a restore issues after a swap.
     */
    private onToggle(event: ToggleEvent): void {
        const open = event.newState === 'open'

        // Counted in `core/scroll-lock`, so a drawer opened over another locked overlay doesn't unlock
        // the page when it alone closes.
        if (open) this.lock()
        else this.unlock()

        for (const opener of this.openers()) opener.setAttribute('aria-expanded', String(open))

        // A CLOSE THAT CAME FROM THE ELEMENT LEAVING THE DOCUMENT MUST NOT ERASE THE MEMORY, or the
        // drawer would be forgotten by the very swap `openFilterGrids` exists to survive — the user
        // would lose it on every filter keystroke. The HTML spec's popover removing steps hide with
        // `fireEvents` false, so this branch should be unreachable; it is one `isConnected` test against
        // an engine that disagrees, and the unlock above deliberately runs either way.
        const target = event.target
        if (!(target instanceof Element) || !target.isConnected) return

        // Restoring is keyed by grid id. A region rendered without one still opens and closes normally;
        // it just cannot be put back after a swap.
        const gridId = this.grid.gridId
        if (!gridId) return
        if (open) openFilterGrids.set(gridId, pageEpoch)
        else openFilterGrids.delete(gridId)
    }

    /** Every opener that claims THIS grid — the region's own FAB and any page-chrome menu button. */
    private openers(): HTMLElement[] {
        return qsa<HTMLElement>(document, '[data-rg-filter-open]').filter(el => this.ownsOpener(el))
    }

    /**
     * The only two callers of the shared scroll-lock counter, so the ledger and the counter cannot drift.
     *
     * Guarded rather than counted: this feature may hold at most one lock, and re-entering (a restore
     * landing on an instance that already locked, a destroy after an explicit close) must not take or
     * release a second one.
     */
    private lock(): void {
        if (this.locked) return
        this.locked = true
        lockScroll()
    }

    private unlock(): void {
        if (!this.locked) return
        this.locked = false
        unlockScroll()
    }

    /**
     * Puts an already-open drawer back after a region swap, without replaying the slide-in.
     *
     * The swap replaced the element, and an element that leaves the document leaves the top layer with
     * it — so this is a genuine `showPopover()`, not a class being re-asserted. From the user's point of
     * view the drawer never moved (the grid behind it re-rendered), so `rg-no-anim` pins out the slide,
     * the fade and the discrete `display` transition. Restoring it any other way animates the panel in
     * from off screen every time a filter is typed.
     *
     * THE CLASS IS TAKEN OFF IN THIS SAME TASK, VIA A FORCED STYLE FLUSH, AND THAT IS A MEASURED FIX
     * RATHER THAN A STYLE PREFERENCE. The first version released it from a double `requestAnimationFrame`
     * — which is correct only while frames are being produced. Reproduced immediately on a backgrounded
     * tab: after a filter keystroke the drawer came back open and correct, and `rg-no-anim` was STILL on
     * it, with no frame left to take it off. A permanently pinned `transition: none` is worse than the
     * flicker it exists to prevent: the drawer would from then on vanish instantly on close instead of
     * sliding out. `runtime/sidebar.ts` item 1 documents the identical trap on the rail's own
     * `data-rg-sidebar-anim`, and rejected a timer for it for the same reason.
     *
     * Reading `offsetHeight` forces a style recalculation with `transition-property: none` in effect, so
     * the engine evaluates the popover's `@starting-style` and every transition-start against a set that
     * is empty — nothing is started. Removing the class immediately after changes no animatable value
     * (the drawer is open in both), so nothing is started then either. No frame, timer or visibility
     * assumption anywhere, and the class cannot outlive the call.
     */
    private restoreOpen(): void {
        const drawer = this.drawer()
        if (!drawer) return

        drawer.classList.add('rg-no-anim')
        try {
            drawer.showPopover()
        } finally {
            void drawer.offsetHeight
            drawer.classList.remove('rg-no-anim')
        }

        // TAKEN HERE AS WELL AS FROM `toggle`, and not because the ledger needs two writers: `toggle` is
        // dispatched in a task of its own, while the instance this one replaces released ITS lock
        // synchronously during teardown. Without this line the two are a paint apart and the page is
        // scrollable behind a drawer that never moved. `lock()` is guarded, so the `toggle` that follows
        // finds the ledger already set and takes nothing.
        if (drawer.matches(':popover-open')) this.lock()
    }

    /**
     * The first match belonging to THIS grid. A grid nested in a detail panel renders its own drawer and
     * FAB, and those sit earlier in the document than this region's own, so an unfiltered lookup would
     * reach into the wrong grid.
     */
    private ownElement<T extends HTMLElement = HTMLElement>(selector: string): T | null {
        return this.findAll<T>(selector).find(element => this.isOwn(element)) ?? null
    }

    /**
     * The close affordances (scrim, header ✕, Done) and Clear all always sit inside the drawer, so
     * inside the region: `isOwn` is the right test for them, and it leaves the buttons of a grid nested in
     * a detail panel to that grid's own instance.
     *
     * ESCAPE AND LIGHT-DISMISS ARE NOT HERE, and their absence is the fix rather than an omission. The
     * drawer is a popover, so Escape is the user agent's — measured before it was one, a real Escape
     * left the drawer up and `body { overflow: hidden }` still held, because nothing in this file
     * listened for a key at all. UA light-dismiss cannot fire (the scrim is a DOM descendant of the
     * popover, so every tap is an INSIDE tap — `runtime/sidebar.ts` item 6 measured exactly that on the
     * rail), which is why the scrim carries `data-rg-filter-close` and is closed by the branch below.
     *
     * The OPENER is the one that may be anywhere — see `ownsOpener`.
     */
    private onClick(event: Event): void {
        const opener = closest(event.target, '[data-rg-filter-open]')
        if (opener) {
            if (this.ownsOpener(opener)) this.setOpen(true)
            return
        }

        const closer = closest(event.target, '[data-rg-filter-close]')
        if (closer) {
            if (this.isOwn(closer)) this.setOpen(false)
            return
        }

        const clearAll = closest(event.target, '[data-rg-filter-clearall]')
        if (clearAll && this.isOwn(clearAll)) this.clearAll(clearAll)
    }

    /**
     * Whether an opener belongs to THIS grid.
     *
     * Two spellings, and the distinction is DOM containment vs. identity:
     *
     *  - `data-rg-filter-open` with a value names a grid id. That is the only form that can work from
     *    outside the region (the page shell's menu), because a node that is not inside any grid has no
     *    containment to be judged by. It is also the stricter of the two: an id either matches or it does
     *    not, so a second grid on the page can never claim the button.
     *  - the valueless form — what the FAB itself renders — keeps its original meaning, "the grid I am
     *    inside". That is what a grid nested in a detail panel depends on: its FAB is a descendant of the
     *    outer region too, and only `closest('.raptor-grid')` resolves it to the inner one.
     */
    private ownsOpener(opener: Element): boolean {
        const named = opener.getAttribute('data-rg-filter-open')
        return named ? named === this.grid.gridId : this.isOwn(opener)
    }

    /**
     * Opens or closes the popover. Everything that follows from that — the lock, the cross-swap memory,
     * `aria-expanded` — is written by the `toggle` handler, which the user agent fires for this path and
     * for the ones that never reach this method.
     *
     * `showPopover()`/`hidePopover()` throw rather than no-op on an element already in the requested
     * state, and both can legitimately be reached that way: a second tap on the FAB while the scrim's
     * close is still in flight, or a restore that raced a mount.
     */
    private setOpen(open: boolean): void {
        const drawer = this.drawer()
        if (!drawer) return
        try {
            if (open) drawer.showPopover()
            else drawer.hidePopover()
        } catch {
            /* already in that state — the `toggle` handler has nothing to correct */
        }
    }

    /**
     * Empties every filter control in the drawer and reloads the grid once.
     *
     * The controls are cleared silently, without dispatching change or input, because each carries its
     * own hx-post and letting them fire would issue one request per cleared filter. The drawer stays
     * open, surviving the swap this triggers through `openFilterGrids`.
     */
    private clearAll(trigger: Element): void {
        // Resolved from the button rather than by searching the region: a nested grid renders its own
        // drawer, which sits earlier in the document than this one, so a region-wide lookup would find
        // the wrong one.
        const drawer = closest(trigger, '.rg-filter-drawer')
        if (!drawer) return

        for (const input of qsa<HTMLInputElement>(drawer, '.rg-pop-input')) input.value = ''
        for (const check of qsa<HTMLInputElement>(drawer, '.rg-pop-check input:checked')) check.checked = false
        for (const select of qsa<HTMLSelectElement>(drawer, '.rg-pop-op')) select.selectedIndex = 0

        // Dropping the filters changes which rows exist, so the old page number no longer means
        // anything.
        const page = this.grid.form?.querySelector<HTMLInputElement>('input[name="page"]')
        if (page) page.value = '1'

        this.refresh()
    }

    private refresh(): void {
        const form = this.grid.form
        if (!form) return
        const htmx = (window as unknown as { htmx?: HtmxTrigger }).htmx
        htmx?.trigger(form, 'raptor:refresh')
    }
}
