/**
 * The page lifecycle: what a boosted navigation swaps, and how anything on the page learns it happened.
 *
 * The element both halves turn on — `#app-root` — is emitted by the library's own `RaptorAppRoot`
 * component, so the rules live here rather than being re-derived by each consuming application.
 */

import {resetScrollLock} from '../core/scroll-lock'
import {refreshGridsIn} from '../grid/api'

/**
 * The element boosted navigations replace. Matches `RaptorAppRoot`'s default `Id`.
 *
 * A single constant rather than a literal repeated at each site: it is the contract between the server
 * component that emits the element, the swap scoping below, and the skeleton's page-region test.
 */
export const PAGE_REGION_ID = 'app-root'

/** True when a settle/swap covers the whole page rather than a fragment inside it. */
export function isPageRegion(target: EventTarget | null): boolean {
    if (target === document.body) return true
    return target instanceof Element && target.id === PAGE_REGION_ID
}

/** Fired after a whole-page swap has settled, and once on first load. Page glue re-runs on this. */
export const PAGE_LOAD_EVENT = 'raptor:page-load'

/**
 * Fired at the start of a history restore (back/forward), before scroll locks are collapsed.
 *
 * Overlay layers that live OUTSIDE `#app-root` — the shared modal container, NotifyManager's confirm —
 * are body children, so the restore swap does not destroy them; without this signal an open dialog would
 * survive the navigation floating over the restored page, holding its scroll lock and its inert marking.
 * Those modules subscribe to this event themselves (see `ModalComponent` and `NotifyManager`): a custom
 * event rather than direct imports, because the modal lives in a lazily-loaded chunk this module must not
 * pull into the entry bundle — and a chunk that never loaded has no overlays to close.
 *
 * Deliberately NOT fired on normal forward navigation: forward swaps replace the region under an overlay
 * that the user may have opened intentionally mid-flight, and the pre-existing teardown paths own that.
 */
export const PAGE_RESTORE_EVENT = 'raptor:page-restore'

/** Dispatches the page-load signal. Exported so a consumer restoring a page WITHOUT an htmx request
 * (a cache hit, a manual innerHTML restore) can announce it the same way. */
export function dispatchPageLoad(): void {
    document.dispatchEvent(new CustomEvent(PAGE_LOAD_EVENT))
}

/**
 * The history-snapshot schema this build writes: snapshots scoped to `#app-root` by `hx-history-elt`.
 *
 * Bump the value whenever the snapshot shape changes again. Entries written by an older build are
 * BODY-scoped (htmx's `getHistoryElement` falls back to `document.body` when no `[hx-history-elt]`
 * exists); restored into the new, narrower region they nest a full document — duplicate chrome and a
 * second `#app-root` — inside it. A deploy-transition tab still holds those entries in sessionStorage,
 * so a mismatched schema mark purges the cache once. This is the primary defence; nav-ux's
 * double-chrome self-heal covers whatever slips past it.
 */
const HIST_SCHEMA_KEY = 'rg-hist-schema'
const HIST_SCHEMA = 'v2-app-root'

/** Disarms the currently-armed restore-scroll keeper, if any. One keeper at a time: a new restore
 * replaces the page the old keeper was guarding, so its position no longer applies. */
let disarmRestoreScrollKeeper: (() => void) | null = null

/**
 * Re-applies htmx's restored scroll position after the background grid refreshes settle.
 *
 * htmx's own restoration works, but it is one-shot: the cache-hit swap re-applies `cached.scroll`
 * one tick later (`updateScrollState`, htmx.esm.js ~3881), and the snapshot markup is tall enough for
 * it to land. The `refreshGridsIn` call in the restore handler then re-POSTs every grid region, and
 * each `outerHTML` swap momentarily shortens the document before the fresh rows lay out — at which
 * point the browser clamps the scroll position and the user finds themselves near the top.
 *
 * The value htmx recorded rides along on the cache-hit `historyRestore` detail (`swapSpec.scroll`,
 * mirrored on `item.scroll` — htmx.esm.js ~3346), so it is re-applied once per grid settle, inside a
 * `requestAnimationFrame` so the client-side grid mount (a microtask) has finished laying out. The
 * keeper disarms once every grid that `refreshGridsIn` triggered has settled, or after a failsafe
 * timeout — a failed or aborted grid request never settles, and a stale keeper must not keep
 * yanking the scroll position later.
 *
 * A cache-miss restore carries no scroll value (its detail is `{path, cacheMiss, serverResponse}`),
 * so nothing is armed and the page stays at the top, which is already correct.
 */
function keepRestoredScroll(detail: unknown): void {
    disarmRestoreScrollKeeper?.()

    const d = detail as { swapSpec?: { scroll?: unknown }; item?: { scroll?: unknown } } | null
    const y = d?.swapSpec?.scroll ?? d?.item?.scroll
    if (typeof y !== 'number') return

    // The same selector `refreshGridsIn` triggered: one settle expected per refreshed grid.
    let remaining = document.querySelectorAll('form.rg-form').length
    if (remaining === 0) return

    const onSettle = (event: Event): void => {
        const target = event.target
        if (!(target instanceof Element && target.classList.contains('raptor-grid'))) return
        requestAnimationFrame(() => window.scrollTo(0, y))
        remaining -= 1
        if (remaining <= 0) disarm()
    }

    const disarm = (): void => {
        document.removeEventListener('htmx:afterSettle', onSettle)
        window.clearTimeout(failsafe)
        if (disarmRestoreScrollKeeper === disarm) disarmRestoreScrollKeeper = null
    }

    const failsafe = window.setTimeout(disarm, 5000)
    document.addEventListener('htmx:afterSettle', onSettle)
    disarmRestoreScrollKeeper = disarm
}

function purgeMismatchedHistoryCache(): void {
    try {
        if (sessionStorage.getItem(HIST_SCHEMA_KEY) === HIST_SCHEMA) return
        sessionStorage.removeItem('htmx-history-cache')
        sessionStorage.setItem(HIST_SCHEMA_KEY, HIST_SCHEMA)
    } catch {
        /* storage unavailable (privacy mode/quota) — htmx history caching is equally unavailable then */
    }
}

/**
 * Arms the lifecycle.
 *
 * Boosted swaps are scoped to the page region per-request rather than with `hx-target`/`hx-select`
 * attributes on `<body>`: those attributes inherit into every descendant's own requests, and an
 * inherited `hx-select` empties any fragment response that does not itself contain `#app-root` — grid
 * regions and modals among them. A boosted response is the inner layout only, so its `#app-root` comes
 * from the layout, which is why `RaptorAppRoot` wraps the layout and not the document shell.
 *
 * Only whole-page swaps are announced. Fragment swaps (modals, grid regions, rows) settle on a
 * descendant and must not re-run page glue, which is how duplicate listeners and double-initialised
 * widgets happen.
 *
 * The first load counts as a page load too, so page glue listens for one event rather than for both
 * this and `DOMContentLoaded`.
 *
 * Back/forward is announced too: `htmx:historyRestore` fires for both cache hits and cache-miss server
 * loads, and a bfcache resurrection (`pageshow` with `persisted`) re-announces the page the browser
 * froze. Scroll after a restore has exactly one owner — the position htmx recorded in its history cache
 * — so the browser's own restoration is switched off for the session.
 */
export function installPageLifecycle(): void {
    purgeMismatchedHistoryCache()

    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

    document.addEventListener('htmx:beforeSwap', event => {
        const detail = (event as CustomEvent).detail
        if (!detail) return

        const boosted = detail.boosted === true || detail.requestConfig?.boosted === true
        if (!boosted) return

        const region = document.getElementById(PAGE_REGION_ID)
        if (!region) return

        detail.target = region
        detail.selectOverride = `#${PAGE_REGION_ID}`
        detail.swapOverride = 'outerHTML show:window:top'
    })

    document.addEventListener('htmx:afterSettle', event => {
        if (isPageRegion(event.target)) dispatchPageLoad()
    })

    // A whole-page load means every overlay that held a scroll lock is gone; a leaked counter would
    // leave the page unscrollable with nothing on screen to release it.
    document.addEventListener(PAGE_LOAD_EVENT, resetScrollLock)

    // Both restore flavours (cache hit and cache-miss server load) end here. The explicit page-load
    // dispatch replaces the old accident where only `isPageRegion`'s body special-case fired it, and the
    // background grid refresh brings the snapshot's serialised rows back to current data.
    //
    // The restore announcement goes FIRST: overlays outside `#app-root` close on it and release their
    // own locks/inert marking through their ordinary teardown paths, and only then is whatever lock
    // depth remains collapsed. The reverse order would zero the counter while a modal still thought it
    // held a lock, leaving the body's inert marking stale.
    document.addEventListener('htmx:historyRestore', event => {
        document.dispatchEvent(new CustomEvent(PAGE_RESTORE_EVENT))
        resetScrollLock()
        dispatchPageLoad()
        refreshGridsIn(document)
        keepRestoredScroll((event as CustomEvent).detail)
    })

    // A cache-miss restore re-fetches the page with a bare XHR (htmx's `loadHistoryFromServer`,
    // htmx.esm.js ~3309). If the session expired meanwhile, that XHR silently follows the 302 to the
    // login page, and the login form would be swapped into `#app-root` under the old URL, inside the
    // full chrome. `htmx:historyCacheMissLoad` is the one hook with the evidence: it fires with the
    // request's `xhr` in its detail BEFORE the response is swapped (the later `htmx:historyRestore`
    // detail for a miss carries no xhr), and htmx reads `detail.response` only AFTER this event returns,
    // so a redirected response can be neutralised in place. On a detected redirect the region's current
    // markup is swapped back over itself (keeping the page visually unchanged) and a full document load
    // takes over via `location.replace`, which lands on the login page with its own chrome and URL.
    document.addEventListener('htmx:historyCacheMissLoad', event => {
        const detail = (event as CustomEvent).detail
        const xhr: XMLHttpRequest | undefined = detail?.xhr
        // responseURL is '' when unsupported or on some opaque failures — nothing provable, stand down.
        if (!xhr || !xhr.responseURL) return
        try {
            const responseUrl = new URL(xhr.responseURL)
            const expected = new URL(detail.path ?? '', window.location.origin)
            const sameDoc = responseUrl.origin === window.location.origin
                && responseUrl.pathname === expected.pathname
            if (sameDoc) return

            const region = document.getElementById(PAGE_REGION_ID)
            if (region) detail.response = region.innerHTML
            window.location.replace(xhr.responseURL)
        } catch {
            /* malformed URL — let the ordinary swap proceed */
        }
    })

    // iOS Safari's bfcache resurrects the frozen document without any htmx involvement; page glue
    // (auth-sensitive buttons among it) must still re-run.
    window.addEventListener('pageshow', event => {
        if (event.persisted) dispatchPageLoad()
    })

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', dispatchPageLoad, {once: true})
    } else {
        dispatchPageLoad()
    }
}
