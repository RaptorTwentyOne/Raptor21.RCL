import { GridFeature } from '../GridFeature'

/** The fields this feature reads off an htmx request event. */
interface HtmxRequestDetail {
    readonly target?: EventTarget | null
    readonly elt?: EventTarget | null
}

function targetOf(event: Event): Element | null {
    const target = (event as CustomEvent<HtmxRequestDetail | undefined>).detail?.target
    return target instanceof Element ? target : null
}

function requesterOf(event: Event): Element | null {
    const elt = (event as CustomEvent<HtmxRequestDetail | undefined>).detail?.elt
    return elt instanceof Element ? elt : null
}

/**
 * Skeleton rows while the region reloads — sized to the GRID, not to the page size.
 *
 * A filter, sort or page change posts the form and swaps the whole region, and until the response
 * lands the OLD rows sit on screen unchanged — the user cannot tell whether their search did anything
 * (measured complaint). The full-region blocking overlay that used to answer this was removed on
 * purpose (2026-07-22); skeleton rows are the non-blocking replacement.
 *
 * ROW COUNT COMES FROM HEIGHT. A count taken from the page size looked wrong the moment the two
 * disagreed (measured: page size 25, server cap 12, ~17 rows of visible grid — a skeleton block with
 * a void under it). The row count that always looks right is the one that fills the space the rows
 * actually occupy: the scroll viewport's height on a viewport-fit grid, the current content height on
 * a natural one — both of which are simply the scroller's clientHeight before the rows are touched.
 * The same rule tops up the deferred first render, whose server side caps at 12 because it cannot
 * know the viewport.
 *
 * The rows are HIDDEN, not destroyed. htmx does not swap on a failed response, and the grid's
 * LoadErrors feature then tells the user the rows below are from the previous query — rows this
 * feature must still be able to put back. On success the whole region is replaced and the hidden
 * tbody leaves with it; nothing to clean up.
 */
export class LoadingSkeleton extends GridFeature {
    /** Below this many rows a skeleton reads as "almost nothing happened". */
    private static readonly MinRows = 3

    /** Sanity cap — a miscomputed row height must not mint a thousand rows. */
    private static readonly MaxRows = 60

    /** When a row measures 0 (display:none ancestors), assume the usual compact row. */
    private static readonly FallbackRowHeight = 40

    init(): void {
        // beforeRequest fires on the REQUESTING element, which for a page-level refresh button need not
        // be inside this region — the document is the only place it reliably bubbles to. Which grid the
        // request belongs to is decided from the swap target, exactly as LoadErrors does.
        this.onDocument('htmx:beforeRequest', event => this.onBeforeRequest(event))

        // A failed or unsendable request never swaps, so the hidden rows must come back; LoadErrors
        // raises its "rows below are from the previous query" bar over them.
        this.onDocument('htmx:responseError', event => this.onFailure(event))
        this.onDocument('htmx:sendError', event => this.onFailure(event))
        this.onDocument('htmx:timeout', event => this.onFailure(event))

        // NO handler for htmx:sendAbort, deliberately: the form's hx-sync="replace" aborts the previous
        // request only because a newer identical-target request is already leaving — restoring rows for
        // one frame between the two would flash.

        // The deferred first render carries server-built skeleton rows capped at 12 (the server cannot
        // know the viewport). Top them up to the grid's real height once the layout pass has fitted it.
        // Double rAF: GridLayout registers after this feature and its first pass is itself coalesced,
        // so one frame later the height may not be final yet. The flag keeps a region that was swapped
        // away in the meantime from being touched through a detached tree.
        let disposed = false
        this.onDestroy(() => { disposed = true })
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!disposed) this.fillDeferred()
        }))
    }

    private onBeforeRequest(event: Event): void {
        // Only a request that will replace this whole region blanks the rows. A cell save targets a
        // <td>, a master-detail load targets the detail panel — both keep the rows meaningful.
        if (targetOf(event) !== this.el) return

        // An infinite-scroll block append never blanks the rows either: it asks for MORE rows below
        // the ones on screen, and hiding those would turn "load the next block" into "the grid went
        // blank". Today the sentinel swaps itself (its request targets the <tr>, so the check above
        // already returns) — this guard states the exemption outright, so a future retarget of the
        // sentinel's response cannot silently regress mid-scroll into a skeleton flash.
        if (requesterOf(event)?.closest('[data-rg-sentinel]')) return

        const tbody = this.tbody()
        const scroller = this.grid.scroller
        if (!tbody || !scroller || tbody.hidden) return

        // The deferred first load already renders skeleton rows server-side; hiding those to show the
        // same thing again would only flicker.
        if (tbody.querySelector('.rg-skeleton-row')) return

        const headerCells = this.headerCells()
        if (headerCells.length === 0) return

        // Measured BEFORE the rows are hidden: on a viewport-fit grid this is the fixed scroll
        // viewport; on a natural-height grid it is the space the current rows occupy, so the region's
        // footer does not jump while the skeleton is up.
        const availableHeight = scroller.clientHeight
        if (availableHeight <= 0) return

        const skeleton = document.createElement('tbody')
        skeleton.className = 'rg-skeleton-tbody'
        skeleton.setAttribute('aria-hidden', 'true')
        skeleton.appendChild(this.buildRow(headerCells))

        tbody.hidden = true
        tbody.after(skeleton)

        // One row is in the document now, so its real height is measurable; the rest are its clones.
        const first = skeleton.firstElementChild as HTMLElement
        const rowHeight = first.offsetHeight || LoadingSkeleton.FallbackRowHeight
        const total = this.clampRows(Math.ceil(availableHeight / rowHeight))
        for (let r = 1; r < total; r++) skeleton.appendChild(first.cloneNode(true))
    }

    /**
     * Grows (or trims) the deferred first render's server-built skeleton to the grid's fitted height.
     * Every skeleton row is identical — the bar widths cycle by COLUMN, not by row — so cloning the
     * first one reproduces the server's markup exactly.
     */
    private fillDeferred(): void {
        const tbody = this.tbody()
        const scroller = this.grid.scroller
        if (!tbody || !scroller || tbody.hidden) return

        const rows = [...tbody.querySelectorAll<HTMLElement>(':scope > tr.rg-skeleton-row')]
        if (rows.length === 0) return

        const rowHeight = rows[0].offsetHeight || LoadingSkeleton.FallbackRowHeight
        const needed = this.clampRows(Math.ceil(scroller.clientHeight / rowHeight))

        for (let r = rows.length; r < needed; r++) tbody.appendChild(rows[0].cloneNode(true))
        for (let r = rows.length - 1; r >= needed; r--) rows[r].remove()
    }

    private onFailure(event: Event): void {
        if (targetOf(event) !== this.el) return

        const tbody = this.tbody()
        if (tbody) tbody.hidden = false
        this.find(':scope > .rg-form > .rg-scrollwrap > table > .rg-skeleton-tbody')?.remove()
    }

    /**
     * The region's own tbody — the `:scope` chain keeps a grid nested inside a master-detail panel
     * from being reached through its host.
     */
    private tbody(): HTMLTableSectionElement | null {
        return this.find<HTMLTableSectionElement>(':scope > .rg-form > .rg-scrollwrap > table > tbody:not(.rg-skeleton-tbody)')
    }

    private headerCells(): HTMLTableCellElement[] {
        return this.findAll<HTMLTableCellElement>(':scope > .rg-form > .rg-scrollwrap > table > thead th')
    }

    private clampRows(count: number): number {
        return Math.min(LoadingSkeleton.MaxRows, Math.max(LoadingSkeleton.MinRows, count))
    }

    private buildRow(headerCells: HTMLTableCellElement[]): HTMLTableRowElement {
        const tr = document.createElement('tr')
        tr.className = 'rg-skeleton-row'

        let barIndex = 0
        for (const th of headerCells) {
            const td = document.createElement('td')
            if (th.classList.contains('rg-expand-cell')) {
                td.className = 'rg-expand-cell'
            } else {
                const bar = document.createElement('span')
                // Same width cycle as the server's SkeletonWidthClass, so this skeleton is
                // indistinguishable from the deferred first load's.
                bar.className = `rg-skeleton rg-skeleton-bar ${LoadingSkeleton.widthClass(barIndex)}`
                td.appendChild(bar)
                barIndex++
            }
            tr.appendChild(td)
        }

        return tr
    }

    private static widthClass(columnIndex: number): string {
        switch (columnIndex % 4) {
            case 0: return 'rg-skeleton-w60'
            case 1: return 'rg-skeleton-w80'
            case 2: return 'rg-skeleton-w40'
            default: return 'rg-skeleton-w70'
        }
    }
}
