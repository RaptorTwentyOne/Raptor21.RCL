import {isPageRegion, PAGE_REGION_ID} from './page-lifecycle'
import {load, render, type Blueprint} from '../skeleton/blueprint'

interface HtmxRequestConfig {
    readonly elt?: EventTarget | null
    readonly verb?: string
    readonly boosted?: boolean
    readonly path?: string
    readonly target?: EventTarget | string | null
    readonly headers?: Record<string, string>
}

/** The fields this module reads off htmx's beforeRequest/beforeSwap CustomEvent detail (the
 * `responseInfo` object htmx builds per-request). Kept partial: htmx's exact detail shape is not part of
 * its public contract. */
interface HtmxResponseDetail {
    readonly target?: EventTarget | null
    readonly boosted?: boolean
    readonly requestConfig?: HtmxRequestConfig
    shouldSwap?: boolean
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

/** Marks every skeleton this module paints — the generic markup below and blueprint-rendered ones alike
 * — so the history handlers can recognise "this region currently shows a placeholder" with one query. */
const SKELETON_MARK_ATTR = 'data-rg-skeleton'

const SKELETON_SELECTOR = `[${SKELETON_MARK_ATTR}], .rg-nav-skeleton`

const SKELETON_MARKUP = `
<div class="rg-nav-skeleton" ${SKELETON_MARK_ATTR} aria-hidden="true">
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
            rendered.setAttribute(SKELETON_MARK_ATTR, '')
            main.replaceChildren(rendered)
            return
        }
    }

    main.innerHTML = SKELETON_MARKUP
}

/**
 * The abandoned page's pre-skeleton reality, captured in `onBeforeRequest` just before the skeleton is
 * painted.
 *
 * htmx snapshots the page it is leaving only once the response arrives (`htmx:beforeHistorySave`,
 * immediately before `saveToHistoryCache`), by which time '.main-content' shows the skeleton — without
 * this backup the history cache would hold placeholders, and every Back would restore a dead skeleton.
 *
 * `scrollY` must be captured BEFORE the skeleton is painted: shrinking '.main-content' makes the browser
 * clamp `window.scrollY` instantly, htmx reads `window.scrollY` at snapshot time, and writing the
 * pristine innerHTML back does not un-clamp it. Deliberately module-local rather than any keyed cache:
 * a cache with TTL/LRU can evict or expire the entry and silently reintroduce the poisoning.
 */
let pendingPristine: { html: string; scrollY: number } | null = null

/**
 * The element whose page-nav request is currently in flight, or null when none is.
 *
 * Kept so Back can cancel it: htmx's popstate handling restores the snapshot immediately, but the
 * abandoned request stays on the wire, and its late response would swap `#app-root` forward again —
 * visually undoing the user's Back. `htmx.trigger(elt, 'htmx:abort')` reaches htmx's body-level abort
 * listener, which aborts the xhr recorded on that element (the same pattern modalSkeleton uses for a
 * dismissed skeleton). The abort path fires `htmx:afterRequest` on the element, so the ordinary
 * clear-on-completion below also covers aborts.
 */
let inflightNavElt: Element | null = null

function abortInflightNav(): void {
    if (!inflightNavElt) return
    const elt = inflightNavElt
    inflightNavElt = null
    htmxApi()?.trigger(elt, 'htmx:abort')
}

/** Idempotency marks page modules historically stamped onto the DOM (`data-sales-dashboard-init`,
 * `data-pg-swiper-ready`, ...). Serialised into a snapshot they suppress re-initialisation after a
 * restore, so they are stripped from the live subtree right before htmx clones it. */
const INIT_MARK_PATTERN = /^data-[a-z-]*init$/
const SWIPER_READY_MARK = 'data-pg-swiper-ready'

function stripInitMarks(root: Element): void {
    const elements = [root, ...root.querySelectorAll('*')]
    for (const el of elements) {
        for (const name of el.getAttributeNames()) {
            if (INIT_MARK_PATTERN.test(name) || name === SWIPER_READY_MARK) el.removeAttribute(name)
        }
    }
}

/** Swiper's loop mode clones its edge slides (`.swiper-slide-duplicate`). Serialised into a snapshot,
 * every restore-and-reinit would clone the clones and the slide count would grow on each Back. They are
 * dropped right before htmx snapshots the subtree — the page is being swapped away, and the app's own
 * swiper init recreates them after a restore (defence in depth: the app side also cleans up in its
 * init). */
function stripSwiperLoopClones(root: Element): void {
    for (const clone of root.querySelectorAll('.swiper-slide-duplicate')) clone.remove()
}

/**
 * Runs synchronously right before htmx clones the history element into its sessionStorage cache.
 *
 * Two clean-ups so the snapshot is a faithful, re-enhanceable page: the skeleton painted by
 * `onBeforeRequest` is swapped back for the real content it replaced (and the scroll position the
 * skeleton clamped is restored — htmx reads `window.scrollY` right after this event), and every
 * DOM-stamped init mark is stripped so restored pages re-initialise. The user never sees the
 * intermediate state: htmx swaps the region immediately afterwards, and forward navigations then apply
 * `show:window:top` anyway.
 */
function onBeforeHistorySave(event: Event): void {
    const main = mainContentEl()
    if (main && main.querySelector(SKELETON_SELECTOR) && pendingPristine) {
        main.innerHTML = pendingPristine.html
        window.scrollTo(0, pendingPristine.scrollY)
    }
    pendingPristine = null

    const historyElt = (event as CustomEvent).detail?.historyElt
    const root = historyElt instanceof Element ? historyElt : document.getElementById(PAGE_REGION_ID)
    if (root) {
        stripInitMarks(root)
        stripSwiperLoopClones(root)
    }
}

function onBeforeRequest(event: Event): void {
    const detail = detailOf(event)
    if (!detail) return

    const target = swapTargetOf(detail)
    if (!isPageNavRequest(detail, target)) return

    inflightNavElt = detail.requestConfig?.elt instanceof Element ? detail.requestConfig.elt : null

    const main = mainContentEl()
    if (!main) return

    const path = detail.requestConfig?.path ?? window.location.href

    // If the region already shows a skeleton (a previous request failed mid-flight), the pristine
    // backup taken then still holds the real content — capturing again would back up the skeleton.
    if (!main.querySelector(SKELETON_SELECTOR)) {
        pendingPristine = {html: main.innerHTML, scrollY: window.scrollY}
    }

    paintSkeleton(main, path)
}

/** After a whole-page swap settles the backup refers to a page that no longer exists; normally
 * `htmx:beforeHistorySave` consumed it already, this covers saves skipped by `hx-history="false"`. */
function onAfterSettle(event: Event): void {
    if (isPageRegion((event as CustomEvent).target as EventTarget | null)) pendingPristine = null
}

/** The tracked page-nav request finished — success, error, timeout or abort all fire this on its
 * element — so there is nothing left for Back to cancel. */
function onAfterRequest(event: Event): void {
    const detail = detailOf(event)
    if (inflightNavElt && detail?.requestConfig?.elt === inflightNavElt) inflightNavElt = null
}

const SELF_HEAL_HEADER = 'RG-Self-Heal'

/** Monotonic generation counter: every popstate restore invalidates whatever self-heal was in flight. */
let healSeq = 0
let healTarget: { seq: number; path: string } | null = null

/**
 * True when the DOM a history restore produced is not a usable page:
 *
 * - a skeleton inside '.main-content' — the snapshot was taken while the placeholder was showing
 *   (an entry written before the pristine-backup fix, or a path the backup missed);
 * - a full-document snapshot pasted INSIDE `#app-root` — a BODY-scoped snapshot taken before
 *   `hx-history-elt` narrowed the history element, restored into the new, narrower region (double
 *   chrome / nested roots; these entries carry no skeleton, so the first symptom alone would miss
 *   them). Detected by library-owned signatures: a second `#app-root`, or a second `[hx-history-elt]`
 *   (either attribute form) nested inside the real one — both can only come from a stale snapshot,
 *   whatever chrome the host application renders. `#rg-top-glass` is the first host's fixed chrome,
 *   kept as a back-compat symptom for entries written before the library-owned markers existed. The
 *   versioned purge in page-lifecycle is the primary defence; this catches whatever it could not.
 */
function needsSelfHeal(): boolean {
    if (document.querySelector(`${MAIN_CONTENT_SELECTOR} [${SKELETON_MARK_ATTR}], ${MAIN_CONTENT_SELECTOR} .rg-nav-skeleton`)) return true
    if (document.querySelector(
        `#${PAGE_REGION_ID} #${PAGE_REGION_ID}, ` +
        `#${PAGE_REGION_ID} [hx-history-elt], ` +
        `#${PAGE_REGION_ID} [data-hx-history-elt], ` +
        `#${PAGE_REGION_ID} #rg-top-glass`,
    )) return true
    return false
}

/**
 * Re-fetches the current path when a restore produced a broken DOM.
 *
 * The re-fetch is ASYNCHRONOUS: on a fast back/forward sequence a second popstate can land before the
 * response does, and htmx's save-first behaviour on every restore would then write the late response's
 * content into the cache under the WRONG url. The generation counter plus the `htmx:beforeSwap` guard
 * below drop any response whose target restore is no longer the current one.
 */
function onHistoryRestore(): void {
    // Belt to the popstate braces below: whichever fires first cancels the abandoned forward request.
    abortInflightNav()

    healSeq++
    if (!needsSelfHeal()) {
        healTarget = null
        return
    }

    healTarget = {seq: healSeq, path: location.pathname + location.search}
    void htmxApi()?.ajax('GET', healTarget.path, {
        target: `#${PAGE_REGION_ID}`,
        select: `#${PAGE_REGION_ID}`,
        swap: 'outerHTML',
        headers: {[SELF_HEAL_HEADER]: '1'},
    })
}

/** Permanent guard: a self-heal response that is stale — a newer restore happened, or the URL moved on —
 * is dropped instead of swapped, so it can never land under another entry's URL nor be re-snapshotted
 * into the history cache with the wrong key. */
function onBeforeSwapGuard(event: Event): void {
    const detail = detailOf(event)
    if (detail?.requestConfig?.headers?.[SELF_HEAL_HEADER] !== '1') return

    const stale = !healTarget
        || healTarget.seq !== healSeq
        || location.pathname + location.search !== healTarget.path
    if (stale) detail.shouldSwap = false
}

/**
 * Perceived-speed and history hygiene for boosted navigations.
 *
 * Forward navigations paint a skeleton while the request is in flight. Back/forward is owned entirely
 * by htmx's history mechanism (popstate + sessionStorage snapshots, scoped to `#app-root` via
 * `hx-history-elt`); this module's job is to keep those snapshots clean — no skeletons, no stamped init
 * marks — and to self-heal the rare restore that still surfaces a broken entry. There is deliberately
 * no second, module-local page cache and no manual `history.pushState`: a single history ledger means
 * htmx's `htmx-current-path-for-history` bookkeeping is never out of sync with the address bar.
 */
export function installNavigationUx(): void {
    document.addEventListener('htmx:beforeRequest', onBeforeRequest)
    document.addEventListener('htmx:beforeHistorySave', onBeforeHistorySave)
    document.addEventListener('htmx:afterSettle', onAfterSettle)
    document.addEventListener('htmx:afterRequest', onAfterRequest)
    document.addEventListener('htmx:historyRestore', onHistoryRestore)
    document.addEventListener('htmx:beforeSwap', onBeforeSwapGuard)

    // Back/forward while a page-nav request is on the wire: the request is cancelled at the earliest
    // signal. `popstate` fires for both restore flavours (htmx installs `window.onpopstate` at init, so
    // its restore runs before this listener); the historyRestore hook above covers any restore htmx
    // performs without a matching popstate reaching us.
    window.addEventListener('popstate', abortInflightNav)

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
        'position:fixed;left:4px;bottom:80px;z-index:var(--rg-z-debug, 900);background:rgb(0 0 0 / .75);color:#0f0;' +
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
