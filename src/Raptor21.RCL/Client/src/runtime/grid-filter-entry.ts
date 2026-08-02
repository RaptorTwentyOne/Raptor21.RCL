/**
 * The client half of `RaptorGridFilterEntry.PageChrome` — the grid whose filter drawer is opened from the
 * page shell's "…" menu instead of from its own floating action button.
 *
 * THE MECHANISM IS NOT HERE. Nothing in this module moves a node, opens a drawer or hides a button. The
 * server renders `data-rg-filter-entry` on the region, two CSS rules keyed on that attribute hide the FAB
 * and drop the footer reservation it needs, and the drawer's own document-level listener
 * (`grid/features/MobileFilterDrawer`) answers the menu button by grid id. All of that works with this
 * file deleted, which is deliberate: the mark has to arrive in the SAME markup as the rows, because the
 * two rules it gates change the footer's height by 60px and applying them a frame after a swap is a
 * measured 60px shift on every page change.
 *
 * What is left for script is the pair of things markup cannot state:
 *
 *  1. THE ASSERTION. `FilterEntry="PageChrome"` on the grid and `<RaptorGridFilterButton For="…"/>` on the
 *     page are two declarations that can drift apart — different files, no compile-time link, and a page
 *     without a `RaptorPageChrome` at all has nowhere to put the button. When the promised opener is not
 *     in the document the mark is taken back off and the FAB reappears, which is exactly the behaviour of
 *     a grid that never asked for the menu. Same shape, and the same reason, as `dropDanglingTrigger` in
 *     `runtime/page-chrome.ts`: a cheap check that converts an unreachable control into a visible one.
 *
 *  2. THE BADGE. The active-filter count lives in the region and is re-rendered by the server on every
 *     swap; the menu button is page markup and is not re-rendered then. So the number is mirrored across
 *     after each swap rather than duplicated in the page's own markup, where it would be stale from the
 *     first filter onwards.
 *
 * Installed eagerly from `index.ts`, like the page-chrome projector and for the same reason: a grid
 * region can swap before its lazily-imported chunk has resolved.
 */

import {cssEscape, qsa} from '../core/dom'
import {PAGE_LOAD_EVENT} from './page-lifecycle'

/** The server-rendered mark. Mirrors `RaptorGridFilterEntry.PageChrome` on the region root. */
const MARK = 'data-rg-filter-entry'

/**
 * The count the region renders inside its own FAB, addressed by the CHILD CHAIN and never by a
 * descendant selector.
 *
 * Measured trap: a grid with a nested grid in an expanded detail row contains that grid's FAB and count
 * as descendants, and they sit EARLIER in the document than its own — a plain
 * `region.querySelector('.rg-filter-count')` read the inner grid's number (measured: 1 instead of 7). The
 * region's own FAB is always exactly `region > .rg-form > .rg-filter-fab`, so the chain is unambiguous.
 */
const OWN_COUNT = ':scope > .rg-form > .rg-filter-fab > .rg-filter-count'

/** The badge on the page's menu button, filled from `OWN_COUNT`. */
const ENTRY_COUNT = '.rg-gridfilter-count'

/**
 * The menu button that claims `gridId`, or null.
 *
 * It must be OUTSIDE the region: the region's own FAB carries the attribute too (valueless, so it does
 * not match the value selector — but a page is free to put a named button anywhere, including inside the
 * grid, and one that swaps away with the region cannot be the thing the mark is promising).
 */
function entryFor(region: Element, gridId: string): HTMLElement | null {
    const selector = `[data-rg-filter-open="${cssEscape(gridId)}"]`
    return qsa<HTMLElement>(document, selector).find(el => !region.contains(el)) ?? null
}

/**
 * One pass over every marked region.
 *
 * Cheap enough to run unconditionally on each swap: the marked regions are the only ones queried, and a
 * page has one or two.
 */
function sync(): void {
    const seen = new Set<string>()

    for (const region of qsa<HTMLElement>(document, `.raptor-grid[${MARK}]`)) {
        const gridId = region.dataset.gridId
        if (!gridId) {
            // Nothing to match a button against; the FAB is the only opener that can still work.
            region.removeAttribute(MARK)
            continue
        }

        // `RaptorGridRegion.Id` defaults to "grid", so two grids on one page that both leave it alone
        // collide silently — and the menu button would then open whichever region the pass happened to
        // reach first. Not repaired here (there is no correct guess), but not left invisible either.
        if (seen.has(gridId)) {
            console.warn(`[raptor21] duplicate data-grid-id "${gridId}" — the page-chrome filter entry cannot tell the two grids apart`)
        }
        seen.add(gridId)

        const entry = entryFor(region, gridId)
        if (!entry) {
            // The promised opener is not on the page: fall back to the FAB, in this frame.
            region.removeAttribute(MARK)
            continue
        }

        const badge = entry.querySelector<HTMLElement>(ENTRY_COUNT)
        if (!badge) continue

        const count = region.querySelector(OWN_COUNT)?.textContent?.trim() ?? ''
        badge.textContent = count
        badge.hidden = count.length === 0
    }
}

export function installGridFilterEntry(): void {
    // NOT filtered by `isPageRegion`. The event this exists for is a GRID REGION swap, which settles on
    // the region and never on `#app-root` — the filter that page-chrome's projector needs is exactly the
    // one that would make this module never run.
    document.addEventListener('htmx:afterSwap', sync)

    // Whole-page swaps (boosted navigation) and the first load. `afterSwap` covers those too, but a page
    // restored from bfcache or announced by a consumer's own `dispatchPageLoad` produces no htmx event.
    document.addEventListener(PAGE_LOAD_EVENT, sync)

    // Back/forward. The restore re-POSTs every grid (see `page-lifecycle`), so a second pass follows on
    // each region's own swap; this one covers the snapshot markup in between.
    document.addEventListener('htmx:historyRestore', sync)
}
