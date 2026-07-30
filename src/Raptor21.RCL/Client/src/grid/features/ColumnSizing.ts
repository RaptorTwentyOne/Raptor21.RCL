import {closest, cssEscape, qsa, readStore, writeStore} from '../../core/dom'
import {GridFeature} from '../GridFeature'
import {closeAllPopups} from './FilterPopups'
import {leafHeaderCells} from './GridLayout'

/** Fallback width for the leading expand/select column before it has been rendered and measured. */
const LEAD_COLUMN_WIDTH = 40

/** Floor a flex column may never be sized below, when the definition names none. */
const DEFAULT_MIN_WIDTH = 80

/**
 * Floor a *drag* may never take a column below, when the header names none. Lower than
 * `DEFAULT_MIN_WIDTH`, so an explicit drag can go narrower than auto-sizing would choose.
 */
const DRAG_MIN_WIDTH = 60

function widthsKey(gridId: string): string {
    return `rg:width:${gridId}`
}

/** A column that shares whatever width the fixed columns leave over. */
interface FlexColumn {
    col: HTMLTableColElement
    min: number
    flex: number
}

/** A resize in progress. Held only between mousedown and mouseup. */
interface ResizeDrag {
    col: HTMLTableColElement
    field: string
    startX: number
    startWidth: number
    min: number
    /** +1, or -1 under RTL where dragging the handle right makes the column narrower. */
    sign: number
    /** Set on the first mousemove: distinguishes a real drag from a click on the handle. */
    moved: boolean
}

/**
 * Column widths: auto-fit, manual resize, and the persistence of the manual ones.
 *
 * Sizing intent is server-rendered onto each `<col>` — `data-rg-w` for an explicit fixed width,
 * `data-rg-flex` for a share of what is left, `data-rg-min` for the floor — and the columns the user
 * has dragged are pinned by a per-grid map in localStorage. `autoSize()` is the single source of truth
 * for every column width: nothing else writes one, so the widths cannot drift apart between a resize, a
 * region swap and a window resize.
 *
 * The pass has no trigger of its own beyond the layout event, because a width is only meaningful against
 * the width of the scroll viewport it has to fill, and the layout pass is what knows that has changed.
 */
export class ColumnSizing extends GridFeature {
    private drag: ResizeDrag | null = null
    private suppressClick: EventListener | null = null
    private suppressTimer = 0
    /** Coalesces raw mousemove into one style write per frame. */
    private resizeRaf = 0
    private pendingResizeEvent: MouseEvent | null = null

    /**
     * Binds the resize interactions. No `raptor:layout` subscriber: GridLayout owns the pass and calls
     * `autoSize()` at a fixed point in its sequence — fit the height, size the columns, place the pins.
     */
    override init(): void {
        this.on('mousedown', event => this.startResize(event as MouseEvent))
        this.on('dblclick', event => this.releaseColumn(event as MouseEvent))

        // A drag leaves the element: the pointer runs off the header, off the grid and often off the
        // window before it is released.
        this.onDocument('mousemove', event => this.trackResize(event as MouseEvent))
        this.onDocument('mouseup', () => this.endResize(true))

        // A swap inside this region mid-drag replaces the <col> being dragged, so the drag is dropped
        // without persisting a width the user never released.
        this.on('htmx:beforeSwap', event => {
            if (this.isOwn(event.target)) this.endResize(false)
        })

        this.onDestroy(() => {
            this.clearClickSuppressor()
            // The resizing class lives on <body> and would otherwise keep the whole page in a
            // col-resize cursor after the region is removed mid-drag.
            if (this.drag) {
                this.drag = null
                document.body.classList.remove('rg-col-resizing')
            }
        })
    }

    /**
     * Distributes the scroll viewport's width across the columns.
     *
     * Fixed columns — an explicit width, or one the user has dragged — keep their pixels; the rest share
     * the remainder by flex weight and never fall below their minimum. When the minimums cannot all fit,
     * every flex column bottoms out and the table overflows into a horizontal scroll.
     *
     * Driven by the layout pass, and safe to call at any time: it rebuilds every width from the
     * definition and storage rather than adjusting what is already there. A no-op in card mode, where
     * the layout pass strips the inline widths.
     */
    autoSize(): void {
        if (this.grid.isCards) return

        const table = this.grid.table
        const scroller = this.grid.scroller
        if (!table || !scroller || !this.grid.gridId) return

        const cols = qsa<HTMLTableColElement>(table, ':scope > colgroup > col')
        const leaf = leafHeaderCells(table)
        if (cols.length === 0 || cols.length !== leaf.length) return

        const stored = this.loadWidths()
        const container = scroller.clientWidth
        let fixedSum = 0
        const flexCols: FlexColumn[] = []

        cols.forEach((col, i) => {
            const field = col.getAttribute('data-rg-col')
            if (!field) {
                const width = Math.round(leaf[i]?.getBoundingClientRect().width || 0) || LEAD_COLUMN_WIDTH
                col.style.width = `${width}px`
                fixedSum += width
                return
            }

            const min = parseInt(col.getAttribute('data-rg-min') || '', 10) || DEFAULT_MIN_WIDTH
            const manual = stored[field]
            const explicit = parseInt(col.getAttribute('data-rg-w') || '', 10)

            // A width the user dragged outranks the definition's own.
            if (manual != null) {
                const width = Math.max(min, manual)
                col.style.width = `${width}px`
                fixedSum += width
                return
            }
            if (!isNaN(explicit)) {
                const width = Math.max(min, explicit)
                col.style.width = `${width}px`
                fixedSum += width
                return
            }
            flexCols.push({col, min, flex: parseFloat(col.getAttribute('data-rg-flex') || '1') || 1})
        })

        let total = fixedSum
        let pool = container - fixedSum

        if (flexCols.length > 0) {
            const minSum = flexCols.reduce((sum, it) => sum + it.min, 0)
            if (pool <= minSum) {
                for (const it of flexCols) {
                    it.col.style.width = `${it.min}px`
                    total += it.min
                }
            } else {
                // Clamping one column to its minimum takes it out of the pool and raises everyone
                // else's share, which can push a second column under its own minimum. Repeat until a
                // round clamps nothing, then split what is left.
                const pending = flexCols.slice()
                let weight = flexCols.reduce((sum, it) => sum + it.flex, 0)
                for (let changed = true; changed;) {
                    changed = false
                    for (let k = pending.length - 1; k >= 0; k--) {
                        const it = pending[k]
                        if (pool * (it.flex / weight) < it.min) {
                            it.col.style.width = `${it.min}px`
                            total += it.min
                            pool -= it.min
                            weight -= it.flex
                            pending.splice(k, 1)
                            changed = true
                        }
                    }
                }
                pending.forEach((it, idx) => {
                    // The last column takes the exact remainder, absorbing the pixels the others lose
                    // to flooring.
                    const width = idx === pending.length - 1 ? Math.round(pool) : Math.floor(pool * (it.flex / weight))
                    it.col.style.width = `${width}px`
                    total += width
                    pool -= width
                    weight -= it.flex
                })
            }
        }

        // minWidth:0 so the declared width is what the table is: the columns already fill the viewport,
        // and a min-width from the stylesheet would stretch it past them.
        table.style.minWidth = '0'
        table.style.width = `${Math.max(container, Math.round(total))}px`
    }

    // --- drag to resize ----------------------------------------------------

    private startResize(event: MouseEvent): void {
        const handle = closest<HTMLElement>(event.target, '[data-rg-resize]')
        if (!handle || !this.isOwn(handle)) return

        // Also stops the draggable <th> from starting a reorder.
        event.preventDefault()
        event.stopPropagation()
        closeAllPopups()

        const th = handle.closest<HTMLElement>('th')
        const table = this.grid.table
        if (!th || !table || !this.grid.gridId) return

        // Only a data column can be dragged: the <col> is found by field, and the leading
        // expand/select column has none.
        const field = th.getAttribute('data-rg-col')
        if (!field) return
        const col = table.querySelector<HTMLTableColElement>(
            `:scope > colgroup > col[data-rg-col="${cssEscape(field)}"]`,
        )
        if (!col) return

        this.drag = {
            col,
            field,
            startX: event.clientX,
            startWidth: parseFloat(col.style.width) || th.getBoundingClientRect().width,
            min: parseInt(th.getAttribute('data-rg-min') || '', 10) || DRAG_MIN_WIDTH,
            sign: getComputedStyle(th).direction === 'rtl' ? -1 : 1,
            moved: false,
        }
        document.body.classList.add('rg-col-resizing')
    }

    /**
     * Records the latest pointer position and defers the style writes to the next frame. Raw mousemove
     * can fire many times per frame, so later events overwrite the pending one and only the most recent
     * is applied.
     */
    private trackResize(event: MouseEvent): void {
        const drag = this.drag
        if (!drag) return
        drag.moved = true

        this.pendingResizeEvent = event
        if (this.resizeRaf) return
        this.resizeRaf = requestAnimationFrame(() => {
            this.resizeRaf = 0
            const pending = this.pendingResizeEvent
            this.pendingResizeEvent = null
            if (pending) this.applyResize(pending)
        })
    }

    /** The actual width writes for a resize step, run at most once per frame. */
    private applyResize(event: MouseEvent): void {
        const drag = this.drag
        if (!drag) return

        const oldWidth = parseFloat(drag.col.style.width) || drag.startWidth
        const newWidth = Math.max(drag.min, Math.round(drag.startWidth + (event.clientX - drag.startX) * drag.sign))
        drag.col.style.width = `${newWidth}px`

        // Carry the delta into the table's own width, so the horizontal scroll range follows the drag
        // instead of only catching up once it ends.
        const table = this.grid.table
        if (table) {
            const tableWidth = parseFloat(table.style.width) || 0
            table.style.width = `${tableWidth - oldWidth + newWidth}px`
        }
    }

    /** Cancels any frame scheduled by `trackResize` that has not run yet. */
    private cancelPendingResize(): void {
        if (this.resizeRaf) {
            cancelAnimationFrame(this.resizeRaf)
            this.resizeRaf = 0
        }
        this.pendingResizeEvent = null
    }

    /**
     * Ends a drag. `persist` is false when the drag was cut short by a swap rather than released, so a
     * width the user never settled on is not written to storage.
     */
    private endResize(persist: boolean): void {
        const drag = this.drag
        if (!drag) return
        this.drag = null

        // Flush the last pending mousemove synchronously, so the final width is where the pointer was
        // released rather than wherever the last painted frame caught it.
        const pending = this.pendingResizeEvent
        this.cancelPendingResize()
        if (pending) {
            this.drag = drag
            this.applyResize(pending)
            this.drag = null
        }

        // A mousedown/mouseup with no movement between them is a click, not a drag: persisting it would
        // pin the column's current auto width.
        if (!drag.moved) persist = false
        document.body.classList.remove('rg-col-resizing')

        if (persist) {
            const width = Math.round(parseFloat(drag.col.style.width))
            if (Number.isFinite(width)) {
                const widths = this.loadWidths()
                widths[drag.field] = width
                this.saveWidths(widths)
            }
        }

        // A full pass, not just autoSize(): pinned offsets are cumulative sums of the measured column
        // widths, so changing a width moves every pinned column after it.
        this.grid.requestLayout()
        this.suppressNextClick()
    }

    /** Double-clicking a handle releases that column back to auto (flex) sizing. */
    private releaseColumn(event: MouseEvent): void {
        const handle = closest<HTMLElement>(event.target, '[data-rg-resize]')
        if (!handle || !this.isOwn(handle)) return

        const field = handle.closest<HTMLElement>('th')?.getAttribute('data-rg-col')
        if (!field) return

        const widths = this.loadWidths()
        delete widths[field]
        this.saveWidths(widths)
        this.grid.requestLayout()
    }

    /**
     * Swallows the click that follows the drag, so releasing over the header cannot also sort by it.
     *
     * Capture phase, to get in before the header's own handler. It removes itself on that first click,
     * and on the next tick for the drags that end over nothing clickable and so produce no click at all.
     */
    private suppressNextClick(): void {
        this.clearClickSuppressor()
        const suppress: EventListener = clickEvent => {
            clickEvent.stopPropagation()
            clickEvent.preventDefault()
            this.clearClickSuppressor()
        }
        this.suppressClick = suppress
        document.addEventListener('click', suppress, true)
        this.suppressTimer = window.setTimeout(() => this.clearClickSuppressor(), 0)
    }

    private clearClickSuppressor(): void {
        if (this.suppressClick) {
            document.removeEventListener('click', this.suppressClick, true)
            this.suppressClick = null
        }
        if (this.suppressTimer) {
            clearTimeout(this.suppressTimer)
            this.suppressTimer = 0
        }
    }

    // --- persistence -------------------------------------------------------

    /**
     * The widths the user has dragged, by field.
     *
     * Anything that is not a finite number is dropped: the map is user-writable storage, and a bad value
     * would otherwise reach `style.width` as `NaNpx` and silently leave that column unsized.
     */
    private loadWidths(): Record<string, number> {
        // No grid id means no bucket: falling back to a shared key would let every id-less grid on the
        // page read and overwrite the same widths.
        if (!this.grid.gridId) return {}

        const stored = readStore<unknown>(widthsKey(this.grid.gridId), null)
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}

        const widths: Record<string, number> = {}
        for (const [field, value] of Object.entries(stored)) {
            if (typeof value === 'number' && Number.isFinite(value)) widths[field] = value
        }
        return widths
    }

    private saveWidths(widths: Record<string, number>): void {
        if (!this.grid.gridId) return
        writeStore(widthsKey(this.grid.gridId), widths)
    }
}
