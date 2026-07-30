/**
 * The page lifecycle: what a boosted navigation swaps, and how anything on the page learns it happened.
 *
 * The element both halves turn on — `#app-root` — is emitted by the library's own `RaptorAppRoot`
 * component, so the rules live here rather than being re-derived by each consuming application.
 */

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

/** Dispatches the page-load signal. Exported so a consumer restoring a page WITHOUT an htmx request
 * (a cache hit, a manual innerHTML restore) can announce it the same way. */
export function dispatchPageLoad(): void {
    document.dispatchEvent(new CustomEvent(PAGE_LOAD_EVENT))
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
 */
export function installPageLifecycle(): void {
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', dispatchPageLoad, {once: true})
    } else {
        dispatchPageLoad()
    }
}
