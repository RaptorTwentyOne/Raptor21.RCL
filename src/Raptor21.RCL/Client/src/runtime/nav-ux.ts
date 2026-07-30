import {refreshGridsIn} from '../grid/api'
import {dispatchPageLoad, isPageRegion} from './page-lifecycle'
import {load, render, type Blueprint} from '../skeleton/blueprint'

interface HtmxRequestConfig {
    readonly elt?: EventTarget | null
    readonly verb?: string
    readonly boosted?: boolean
    readonly path?: string
    readonly target?: EventTarget | string | null
}

/** The fields this module reads off htmx's beforeRequest/afterRequest CustomEvent detail (the
 * `responseInfo` object htmx builds per-request). Kept partial: htmx's exact detail shape is not part of
 * its public contract. */
interface HtmxResponseDetail {
    readonly target?: EventTarget | null
    readonly boosted?: boolean
    readonly requestConfig?: HtmxRequestConfig
}

function detailOf(event: Event): HtmxResponseDetail | undefined {
    return (event as CustomEvent<HtmxResponseDetail | undefined>).detail ?? undefined
}

/** The element htmx resolved as its swap target. `requestConfig.target` can arrive as either the
 * resolved element or the raw selector still awaiting resolution, depending on the htmx version, so all
 * shapes are handled. */
function swapTargetOf(detail: HtmxResponseDetail): Element | null {
    if (detail.target instanceof Element) return detail.target

    const configTarget = detail.requestConfig?.target
    if (configTarget instanceof Element) return configTarget
    if (typeof configTarget === 'string') return document.querySelector(configTarget)

    return null
}

/** True for a request this module owns: a whole-page navigation swapping the page region — boosted, or
 * an anchor explicitly targeting it — rather than a grid region reload, a modal open, or any other
 * in-page fragment swap. */
function isPageNavRequest(detail: HtmxResponseDetail, target: Element | null): boolean {
    if (!isPageRegion(target)) return false
    const cfg = detail.requestConfig
    const boosted = detail.boosted === true || cfg?.boosted === true
    const isAnchorElt = cfg?.elt instanceof HTMLAnchorElement
    return boosted || isAnchorElt
}

function htmxApi(): any {
    return (window as any).htmx
}

const MAIN_CONTENT_SELECTOR = '.main-content'

const SKELETON_MARKUP = `
<div class="rg-nav-skeleton" aria-hidden="true">
    <div class="rg-nav-skeleton-titlebar">
        <span class="rg-skeleton rg-nav-skeleton-title"></span>
        <span class="rg-skeleton rg-nav-skeleton-action"></span>
    </div>
    <div class="rg-nav-skeleton-cards">
        <span class="rg-skeleton rg-nav-skeleton-card"></span>
        <span class="rg-skeleton rg-nav-skeleton-card"></span>
        <span class="rg-skeleton rg-nav-skeleton-card"></span>
        <span class="rg-skeleton rg-nav-skeleton-card"></span>
    </div>
    <div class="rg-nav-skeleton-table">
        <span class="rg-skeleton rg-nav-skeleton-table-head"></span>
        <span class="rg-skeleton rg-nav-skeleton-row"></span>
        <span class="rg-skeleton rg-nav-skeleton-row"></span>
        <span class="rg-skeleton rg-nav-skeleton-row"></span>
        <span class="rg-skeleton rg-nav-skeleton-row"></span>
        <span class="rg-skeleton rg-nav-skeleton-row"></span>
        <span class="rg-skeleton rg-nav-skeleton-row"></span>
        <span class="rg-skeleton rg-nav-skeleton-row"></span>
        <span class="rg-skeleton rg-nav-skeleton-row"></span>
    </div>
</div>`

function mainContentEl(): HTMLElement | null {
    return document.querySelector<HTMLElement>(MAIN_CONTENT_SELECTOR)
}

/** The blueprint learned for `path` by the skeleton auto-harvest, if this page ever declared container
 * regions and got as far as a settled visit. */
function loadPageBlueprint(path: string): Blueprint | null {
    try {
        const pathname = new URL(path, window.location.origin).pathname
        const blueprint = load(pathname)
        return blueprint && blueprint.length > 0 ? blueprint : null
    } catch {
        return null
    }
}

/** Paints the page-shaped skeleton when one has been learned for this path; otherwise falls back to the
 * generic titlebar/cards/table placeholder. */
function paintSkeleton(main: HTMLElement, path: string): void {
    const blueprint = loadPageBlueprint(path)

    if (blueprint) {
        const rendered = render(blueprint)
        if (rendered instanceof HTMLElement) {
            main.replaceChildren(rendered)
            return
        }
    }

    main.innerHTML = SKELETON_MARKUP
}

interface PageSnapshot {
    readonly title: string
    readonly html: string
    readonly scrollY: number
    readonly timestamp: number
}

const MAX_CACHE_ENTRIES = 10
const CACHE_TTL_MS = 5 * 60 * 1000

/** Insertion order == recency order: touched entries are deleted and re-set so they land at the end,
 * which is the ordering Map.keys() needs for "oldest first" eviction below. */
const pageCache = new Map<string, PageSnapshot>()

/** Cache key: pathname + search, dropping origin and hash — two boosted requests for the same page differ
 * only there, and a hash-only navigation shouldn't be treated as a different page. */
function cacheKey(rawPath: string): string {
    try {
        const url = new URL(rawPath, window.location.origin)
        return url.pathname + url.search
    } catch {
        return rawPath
    }
}

/**
 * The URL a GET request will actually ask for.
 *
 * htmx keeps a GET's parameters out of `requestConfig.path` — it appends them when it issues the request.
 * Keying the cache on the bare path would therefore make every query-string variant of a page look like
 * the same page: the first one visited gets restored for all of them, and because a cache hit calls
 * `event.preventDefault()`, the real request is cancelled and the filter silently does nothing.
 *
 * Array values are expanded to repeated keys rather than joined, which is how htmx encodes them, so the
 * key matches the URL that would have been fetched.
 */
function requestedUrl(config: { path?: string; parameters?: Record<string, unknown> } | undefined): string {
    const path = config?.path ?? window.location.href
    const parameters = config?.parameters
    if (!parameters) return path

    const query = new URLSearchParams()
    for (const [name, value] of Object.entries(parameters)) {
        if (value === null || value === undefined) continue
        if (Array.isArray(value)) {
            value.forEach(entry => query.append(name, String(entry)))
        } else {
            query.append(name, String(value))
        }
    }

    const encoded = query.toString()
    if (!encoded) return path

    return path + (path.includes('?') ? '&' : '?') + encoded
}

function pathnameOfKey(key: string): string {
    const q = key.indexOf('?')
    return q === -1 ? key : key.slice(0, q)
}

function touchCache(key: string, entry: PageSnapshot): void {
    pageCache.delete(key)
    pageCache.set(key, entry)
    while (pageCache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = pageCache.keys().next().value
        if (oldestKey === undefined) break
        pageCache.delete(oldestKey)
    }
}

/** Reading counts as use: a hit is moved to the most-recently-used end so a hot page is not evicted
 * merely because other pages were visited, but not revisited, more recently. */
function getCached(key: string): PageSnapshot | null {
    const entry = pageCache.get(key)
    if (!entry) return null

    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        pageCache.delete(key)
        return null
    }

    pageCache.delete(key)
    pageCache.set(key, entry)
    return entry
}

function invalidateByPathname(pathname: string): void {
    for (const key of Array.from(pageCache.keys())) {
        if (pathnameOfKey(key) === pathname) pageCache.delete(key)
    }
}

/** Snapshots whatever '.main-content' currently holds under the current URL. Called both after every
 * settled boosted swap and once at install time — the latter covers the very first page of a session,
 * which never fires htmx:afterSettle because it wasn't htmx that put it there. */
function snapshotCurrentPage(): void {
    const main = mainContentEl()
    if (!main) return

    const key = cacheKey(window.location.pathname + window.location.search)
    touchCache(key, {
        title: document.title,
        html: main.innerHTML,
        scrollY: window.scrollY,
        timestamp: Date.now(),
    })
}

/**
 * Paints a cached snapshot back without a network round trip.
 *
 * The history entry is pushed with the same `{htmx: true}` state shape htmx's own `pushUrlIntoHistory`
 * uses, so htmx's popstate handler still recognises the entry as one of its own. The restored subtree
 * arrives as plain innerHTML, so its `hx-*` attributes stay inert until htmx processes it; the page-load
 * signal then lets page glue reinitialise exactly as it would after a live navigation, and every
 * restored grid re-requests its current filter/sort/page state in the background.
 */
function restoreFromCache(main: HTMLElement, path: string, snapshot: PageSnapshot): void {
    const url = new URL(path, window.location.origin)

    history.pushState({htmx: true}, '', url.pathname + url.search + url.hash)

    document.title = snapshot.title
    main.innerHTML = snapshot.html
    window.scrollTo(0, snapshot.scrollY)

    htmxApi()?.process(main)

    dispatchPageLoad()

    refreshGridsIn(main)

    touchCache(cacheKey(path), snapshot)
}

function onBeforeRequest(event: Event): void {
    const detail = detailOf(event)
    if (!detail) return

    const target = swapTargetOf(detail)
    if (!isPageNavRequest(detail, target)) return

    const main = mainContentEl()
    if (!main) return

    const verb = (detail.requestConfig?.verb ?? 'get').toLowerCase()
    const path = verb === 'get'
        ? requestedUrl(detail.requestConfig)
        : detail.requestConfig?.path ?? window.location.href

    if (verb === 'get') {
        const cached = getCached(cacheKey(path))
        if (cached) {
            event.preventDefault()
            restoreFromCache(main, path, cached)
            return
        }
    }

    paintSkeleton(main, path)
}

function onAfterSettle(event: Event): void {
    const target = (event as CustomEvent).target as EventTarget | null
    if (!isPageRegion(target)) return
    snapshotCurrentPage()
}

/** Invalidation is not scoped to "was this a save": any non-boosted POST (form save, delete action, grid
 * mutation, ...) marks that URL's cached snapshot stale. A grid's own paging/sort/filter POSTs trigger
 * this too, which costs those pages one extra cache-miss fetch the next time they are revisited. */
function onAfterRequest(event: Event): void {
    const detail = detailOf(event)
    const cfg = detail?.requestConfig
    if (!cfg) return
    if (detail?.boosted === true || cfg.boosted === true) return

    const verb = (cfg.verb ?? '').toLowerCase()
    if (verb !== 'post') return

    try {
        invalidateByPathname(new URL(cfg.path ?? window.location.href, window.location.origin).pathname)
    } catch {
        /* malformed path — nothing to key an invalidation on; a stale entry lingers until its TTL expires */
    }
}

export function installNavigationUx(): void {
    document.addEventListener('htmx:beforeRequest', onBeforeRequest)
    document.addEventListener('htmx:afterSettle', onAfterSettle)
    document.addEventListener('htmx:afterRequest', onAfterRequest)

    snapshotCurrentPage()

    installViewportDebugBadge()
}

/** On-device viewport diagnostics, activated with `?rgdebug=1` and persisted for the tab via
 * sessionStorage so boosted navigations keep it. Prints the viewport measurements that desktop tooling
 * cannot reproduce on a phone. */
function installViewportDebugBadge(): void {
    try {
        if (new URLSearchParams(window.location.search).has('rgdebug')) sessionStorage.setItem('rg-debug', '1')
        if (sessionStorage.getItem('rg-debug') !== '1') return
    } catch {
        return
    }

    const badge = document.createElement('div')
    badge.id = 'rg-debug-badge'
    badge.style.cssText =
        'position:fixed;left:4px;bottom:80px;z-index:99999;background:rgb(0 0 0 / .75);color:#0f0;' +
        'font:10px/1.5 monospace;padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre;'
    document.body.appendChild(badge)

    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top, 0px);visibility:hidden;'
    document.body.appendChild(probe)

    const update = () => {
        const vv = window.visualViewport
        const main = document.querySelector<HTMLElement>('.main-content')
        const content = document.querySelector<HTMLElement>('.content')
        badge.textContent =
            `innerH: ${window.innerHeight}\n` +
            `vv.h: ${vv ? Math.round(vv.height) : '-'} off: ${vv ? Math.round(vv.offsetTop) : '-'}\n` +
            `scrollY: ${Math.round(window.scrollY)}\n` +
            `docH: ${document.documentElement.scrollHeight}\n` +
            `envTop: ${probe.getBoundingClientRect().height}\n` +
            `mainH: ${main ? Math.round(main.getBoundingClientRect().height) : '-'}\n` +
            `contentTop: ${content ? Math.round(content.getBoundingClientRect().top + window.scrollY) : '-'}mt:${content ? getComputedStyle(content).marginTop : '-'}`
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, {passive: true})
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    document.addEventListener('raptor:page-load', () => setTimeout(update, 50))
    document.addEventListener('change', () => setTimeout(update, 150))
    setInterval(update, 1000)
}
