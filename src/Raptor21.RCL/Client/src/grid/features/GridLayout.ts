import { cssEscape, qsa } from '../../core/dom'
import { GridFeature } from '../GridFeature'
import { ColumnPinning } from './ColumnPinning'
import { ColumnSizing } from './ColumnSizing'

/** px of breathing room left below a viewport-filling grid. */
const GRID_BOTTOM_GAP = 12

/**
 * px — below this width the grid folds each row into a stacked card (mobile).
 *
 * Duplicated as a media query in `styles/grid/_grid.scss` (`max-width: 639.98px`), which paints the
 * card layout on the server's markup before this file has even been fetched; keep the two in step.
 */
const CARD_BREAKPOINT = 640

/** Minimum height a viewport-fitted grid may shrink to before it starts scrolling the page instead. */
const MIN_GRID_HEIGHT = 220

/**
 * Leaf header `<th>` in colgroup order — works for both the flat header and the two-row grouped header
 * (where leaf cells are split across the group row (ungrouped, rowspan) and the leaf row (grouped)).
 *
 * Lives here rather than on the class because column sizing and pinning need the same colgroup→header
 * mapping, and both derive their offsets from the widths it returns.
 */
export function leafHeaderCells(table: HTMLTableElement): (HTMLElement | null)[] {
    const thead = table.tHead
    if (!thead) return []
    const cols = qsa<HTMLTableColElement>(table, ':scope > colgroup > col')
    const lead = qsa<HTMLElement>(thead, 'th.rg-expand-cell, th.rg-sel-cell')
    let leadIndex = 0
    return cols.map(col => {
        const field = col.getAttribute('data-rg-col')
        if (field) return thead.querySelector<HTMLElement>(`th[data-rg-col="${cssEscape(field)}"]`)
        return lead[leadIndex++] ?? null
    })
}

/**
 * Sizing for one grid.
 *
 * The grid fills the remaining viewport height so its header and footer stay fixed on screen and only
 * the body between them scrolls. Master-detail content is sized to the scroll viewport's *visible*
 * width so it never stretches to the full, horizontally-scrolled table width. Nested grids (inside a
 * detail panel) are exempt from viewport-fit and get a bounded body via CSS.
 *
 * Everything measured here depends on the element being in the document at its final position, so the
 * pass runs on mount (after htmx has settled the region) and on resize.
 */
export class GridLayout extends GridFeature {
    /** Last region width the ResizeObserver acted on — so a height-only change doesn't re-run the pass. */
    private lastWidth = -1

    override init(): void {
        this.layout()

        // requestLayout() coalesces bursts into one frame and announces them here.
        this.on('raptor:layout', () => this.layout())
        this.onWindow('resize', () => this.grid.requestLayout())

        // A swap that replaces content *inside* the region (a master-detail panel opening, an
        // infinite-scroll block append) leaves this instance mounted, so only an explicit relayout
        // re-measures against the new content.
        this.on('htmx:afterSettle', event => {
            if (this.isOwn(event.target)) this.grid.requestLayout()
        })

        this.observeWidth()
    }

    /**
     * Relayouts on width changes to the region.
     *
     * Catches a hidden→visible transition (width 0→n), which a grid built inside a `display:none` tab
     * needs to escape the minimum widths it measured while hidden, and container resizes that the window
     * `resize` event misses, such as a sidebar toggle or a splitter. Only width is acted on: `fit()`
     * writes the region's height, so reacting to height would chase that write into a loop.
     */
    private observeWidth(): void {
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(entries => {
            const width = Math.round(entries[entries.length - 1]?.contentRect.width ?? 0)
            if (width === this.lastWidth) return
            this.lastWidth = width
            if (width > 0) this.grid.requestLayout()
        })
        observer.observe(this.el)
        this.onDestroy(() => observer.disconnect())
    }

    /**
     * One full sizing pass. This is what `GridComponent.requestLayout()` coalesces into, so callers
     * that only need a reflow should ask for one there rather than calling this directly.
     */
    layout(): void {
        const width = this.el.getBoundingClientRect().width
        // Either test puts the grid in card mode. The region width is the meaningful one — it catches a
        // grid squeezed into a sidebar or a detail panel on a wide screen — but the stylesheet's
        // first-paint fallback can only ask about the viewport, so the viewport test is repeated here to
        // keep the two from disagreeing: a region measuring wider than the breakpoint inside a narrower
        // viewport (a horizontally scrolling container) would otherwise get CSS cards with the desktop
        // pass's inline height and column widths written over them.
        if ((width > 0 && width < CARD_BREAKPOINT) || window.innerWidth < CARD_BREAKPOINT) {
            // The card layout is pure CSS (.rg-cards); stripping the desktop inline styles is all that
            // is needed for it to take over.
            this.el.classList.add('rg-cards')
            this.clearInlineLayout()
            return
        }
        this.el.classList.remove('rg-cards')
        this.fit()
        this.grid.feature(ColumnSizing)?.autoSize()
        this.grid.feature(ColumnPinning)?.apply()
        this.stickyGroupHeader()
        this.sizeDetails()
    }

    /**
     * Size every open master-detail panel to the scroll viewport's visible width. The panel is
     * sticky-left in CSS, so this keeps it within what's on screen regardless of horizontal scroll.
     *
     * Callable on its own, so opening a detail row can re-size the new panel without a full layout pass.
     */
    sizeDetails(): void {
        const scroller = this.grid.scroller
        if (!scroller) return
        const width = scroller.clientWidth
        for (const detail of this.own('tr.rg-detail-row:not([hidden]) > .rg-detail-cell > .rg-detail')) {
            detail.style.width = `${width}px`
        }
    }

    /**
     * Fill from the grid's top edge down to the bottom of the viewport, so the footer pins to the
     * bottom of the screen. A nested grid keeps its CSS-bounded body instead — fitting it to the
     * viewport would run the detail panel off the bottom of the page.
     */
    private fit(): void {
        if (this.grid.isNested) {
            this.el.classList.add('rg-nested')
            this.el.style.height = ''
            return
        }
        const top = this.el.getBoundingClientRect().top
        const height = Math.max(MIN_GRID_HEIGHT, Math.round(window.innerHeight - top - GRID_BOTTOM_GAP))
        this.el.style.height = `${height}px`
    }

    /**
     * Strip all JS-applied inline layout so the card CSS can take over cleanly: widths, viewport-fit
     * height, pin offsets, group-header offsets, detail width.
     */
    private clearInlineLayout(): void {
        this.el.style.height = ''

        const table = this.grid.table
        if (table) {
            table.style.width = ''
            table.style.minWidth = ''
            for (const col of qsa<HTMLTableColElement>(table, ':scope > colgroup > col')) {
                col.style.width = ''
            }
            const thead = table.tHead
            if (thead) {
                for (const th of qsa<HTMLElement>(thead, '.rg-leafrow th')) th.style.top = ''
            }
        }

        for (const cell of this.own('.rg-pin')) {
            cell.classList.remove('rg-pin', 'rg-pin-left', 'rg-pin-right', 'rg-pin-edge')
            cell.style.position = ''
            cell.style.left = ''
            cell.style.right = ''
            cell.style.zIndex = ''
        }

        for (const detail of this.own('tr.rg-detail-row > .rg-detail-cell > .rg-detail')) {
            detail.style.width = ''
        }
    }

    /**
     * In a grouped (two-row) header, push the leaf row down by the group row's height so both rows
     * stay sticky-stacked instead of overlapping at top:0.
     */
    private stickyGroupHeader(): void {
        const thead = this.grid.table?.tHead
        if (!thead) return
        const groupRow = thead.querySelector<HTMLElement>('.rg-grouprow')
        const leafRow = thead.querySelector<HTMLElement>('.rg-leafrow')
        if (!groupRow || !leafRow) return
        const height = Math.round(groupRow.getBoundingClientRect().height)
        for (const th of qsa<HTMLElement>(leafRow, 'th')) th.style.top = `${height}px`
    }

    /**
     * Descendants matching `selector` that belong to THIS grid. A grid can host another grid inside a
     * detail panel, and its rows, pinned cells and detail panels all match the same selectors — sizing
     * them from here would fight the nested grid's own layout pass.
     */
    private own<T extends HTMLElement = HTMLElement>(selector: string): T[] {
        return this.findAll<T>(selector).filter(element => this.isOwn(element))
    }
}
