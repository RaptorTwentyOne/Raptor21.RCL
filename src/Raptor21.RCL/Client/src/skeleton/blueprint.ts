/**
 * Per-page and per-modal loading skeletons.
 *
 * The generic navigation and modal skeletons paint the same placeholder for every region regardless of
 * what it holds. `RaptorContainer` lets a page annotate its regions with
 * `data-rg-skel="kpi|cards|table|form|chart|block"`; this module harvests those annotations off the
 * settled DOM, remembers them per URL, and renders a matching shimmer layout the next time that URL's
 * skeleton is needed. A dashboard's next load therefore shows a KPI row and a card grid rather than the
 * generic placeholder, without either skeleton consumer knowing anything about pages.
 */

import {isPageRegion} from '../runtime/page-lifecycle'

const ATTR = 'data-rg-skel'
const COUNT_ATTR = 'data-rg-skel-count'
const COLS_ATTR = 'data-rg-skel-cols'

export interface BlueprintBlock {
    /**
     * One of `RaptorContainer`'s Skeleton values: kpi, cards, table, form, chart, block.
     *
     * A plain string rather than a union, so an unrecognised value falls back to a plain block instead of
     * vanishing from the render.
     */
    t: string
    /** Item-count hint (KPI tiles, cards, table rows, form fields). */
    n?: number
    /** Column-count hint (cards grid). */
    c?: number
}

export type Blueprint = BlueprintBlock[]

function parseCount(raw: string | null): number | undefined {
    if (!raw) return undefined
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * Collects the outermost `[data-rg-skel]` elements under `root`, in document order.
 *
 * A container nested inside another is not counted on its own, so only the outer shape drives the
 * placeholder: form fields inside a container marked `Skeleton=form` are one "form" block, not one block
 * each.
 */
export function harvest(root: Element | null): Blueprint {
    if (!root) return []

    const blocks: BlueprintBlock[] = []
    const seen = new Set<Element>()

    for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${ATTR}]`))) {
        let ancestor = el.parentElement
        let nested = false
        while (ancestor && ancestor !== root.parentElement) {
            if (seen.has(ancestor)) {
                nested = true
                break
            }
            ancestor = ancestor.parentElement
        }
        if (nested) continue

        seen.add(el)
        const t = el.getAttribute(ATTR)
        if (!t) continue

        const block: BlueprintBlock = {t}
        const n = parseCount(el.getAttribute(COUNT_ATTR))
        if (n !== undefined) block.n = n
        const c = parseCount(el.getAttribute(COLS_ATTR))
        if (c !== undefined) block.c = c
        blocks.push(block)
    }

    return blocks
}

const STORE_PREFIX = 'rg-skel:v1:'

/**
 * Persists a blueprint for later.
 *
 * Failures are swallowed: localStorage can throw on quota, in private mode, or when storage is disabled,
 * and the next navigation then falls back to the generic skeleton as it would on a first visit.
 */
export function store(key: string, blueprint: Blueprint): void {
    if (blueprint.length === 0) return
    try {
        localStorage.setItem(STORE_PREFIX + key, JSON.stringify(blueprint))
    } catch {
        /* storage unavailable — the generic skeleton is used instead */
    }
}

export function load(key: string): Blueprint | null {
    try {
        const raw = localStorage.getItem(STORE_PREFIX + key)
        if (!raw) return null
        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed) ? (parsed as Blueprint) : null
    } catch {
        return null
    }
}

// ==================== Rendering ====================

function el(tag: string, className: string): HTMLElement {
    const node = document.createElement(tag)
    node.className = className
    return node
}

function shimmer(className: string): HTMLElement {
    return el('span', `rg-skeleton ${className}`)
}

function renderKpi(block: BlueprintBlock): HTMLElement {
    const row = el('div', 'rg-skel-kpi-row')
    const count = block.n ?? 4
    for (let i = 0; i < count; i++) row.appendChild(shimmer('rg-skel-kpi'))
    return row
}

function renderCards(block: BlueprintBlock): HTMLElement {
    const grid = el('div', 'rg-skel-card-grid')
    const cols = block.c ?? 4
    grid.style.setProperty('--rg-skel-cols', String(cols))
    const count = block.n ?? cols
    for (let i = 0; i < count; i++) grid.appendChild(shimmer('rg-skel-card'))
    return grid
}

function renderTable(block: BlueprintBlock): HTMLElement {
    const table = el('div', 'rg-skel-table')
    table.appendChild(shimmer('rg-skel-table-head'))
    const rows = Math.min(block.n ?? 8, 10)
    for (let i = 0; i < rows; i++) table.appendChild(shimmer('rg-skel-table-row'))
    return table
}

function renderForm(block: BlueprintBlock): HTMLElement {
    const form = el('div', 'rg-skel-form')
    const count = block.n ?? 4
    for (let i = 0; i < count; i++) {
        const field = el('div', 'rg-skeleton-field')
        field.appendChild(shimmer('rg-skeleton-line'))
        field.appendChild(shimmer('rg-skeleton-input'))
        form.appendChild(field)
    }
    return form
}

function renderChart(): HTMLElement {
    return shimmer('rg-skel-chart')
}

function renderBlock(): HTMLElement {
    return shimmer('rg-skel-block')
}

const RENDERERS: Record<string, (block: BlueprintBlock) => HTMLElement> = {
    kpi: renderKpi,
    cards: renderCards,
    table: renderTable,
    form: renderForm,
    chart: renderChart,
    block: renderBlock,
}

/** Builds the shimmer DOM for a stored blueprint, one block per container the page or modal declared. */
export function render(blueprint: Blueprint): HTMLElement {
    const root = el('div', 'rg-nav-skeleton')
    root.setAttribute('aria-hidden', 'true')

    for (const block of blueprint) {
        const renderer = RENDERERS[block.t] ?? renderBlock
        root.appendChild(renderer(block))
    }

    return root
}

// ==================== Auto-harvest ====================

const MAIN_CONTENT_SELECTOR = '.main-content'

function harvestAndStore(): void {
    const main = document.querySelector(MAIN_CONTENT_SELECTOR)
    const blueprint = harvest(main)
    if (blueprint.length > 0) store(window.location.pathname, blueprint)
}

/**
 * Learns each page's shape as it is visited, with no per-page wiring: any page that wraps its regions in
 * a container gets a matching skeleton on its next load automatically.
 *
 * Runs once for the current hard-loaded page, for which `afterSettle` never fires because htmx did not
 * put it there, and again after every boosted whole-page swap. An empty blueprint is never stored, so a
 * page that declares no containers keeps falling back to the generic skeleton.
 */
export function installAutoHarvest(): void {
    harvestAndStore()

    document.addEventListener('htmx:afterSettle', event => {
        // Whole-page swaps only. The test lives in page-lifecycle.ts, which also owns the scoping that
        // makes a boosted swap settle on the page region in the first place.
        if (isPageRegion(event.target)) harvestAndStore()
    })
}
