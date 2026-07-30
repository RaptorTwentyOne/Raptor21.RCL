import { qsa } from '../../core/dom'
import { GridFeature } from '../GridFeature'
import { leafHeaderCells } from './GridLayout'

type PinSide = 'left' | 'right'

/**
 * Sticky (pinned) columns.
 *
 * The leading expand/select column and the left-pinned data columns stick to the left edge, the
 * right-pinned ones to the right, each offset by the cumulative width of the pinned columns before it.
 * Pinning is therefore a pure function of the *measured* header widths, which is why it has no trigger
 * of its own: it can only run once the sizing pass has settled the columns. The layout pass drives it.
 *
 * Pinned columns are contiguous at each edge — the column definition already emits them in that order —
 * so each scan walks in from its edge and stops at the first unpinned column.
 */
export class ColumnPinning extends GridFeature {
    /** Binds nothing: GridLayout calls `apply()` at the point in its sequence where widths are settled. */
    override init(): void {
    }

    /**
     * Sticks the pinned columns to their edges. Rebuilt from scratch on every call, so it is safe to
     * re-run at any point once the columns have been sized.
     */
    apply(): void {
        if (this.grid.isCards) {
            this.clear()
            return
        }

        const table = this.grid.table
        if (!table) return

        const cols = qsa<HTMLTableColElement>(table, ':scope > colgroup > col')
        const leaf = leafHeaderCells(table)
        const n = cols.length
        if (n === 0 || leaf.length !== n) return

        this.clear()

        const sideOf = cols.map(c => (c.getAttribute('data-rg-col') ? c.getAttribute('data-rg-pinned') || '' : 'lead'))
        const anyLeft = sideOf.includes('left')
        if (!anyLeft && !sideOf.includes('right')) return

        const widths = leaf.map(c => c?.getBoundingClientRect().width || 0)

        const dataCells = (row: HTMLTableRowElement): HTMLTableCellElement[] =>
            [...row.cells].filter(c => !c.classList.contains('rg-card'))

        const bodyRows = [...(table.tBodies[0]?.rows ?? [])].map(dataCells).filter(cells => cells.length === n)

        const columnCells = (i: number): (HTMLElement | null)[] => [leaf[i], ...bodyRows.map(cells => cells[i])]

        const pin = (i: number, side: PinSide, offset: number): void => {
            const cls = side === 'left' ? 'rg-pin-left' : 'rg-pin-right'
            columnCells(i).forEach((cell, idx) => {
                if (!cell) return
                cell.classList.add('rg-pin', cls)
                cell.style.position = 'sticky'
                cell.style.setProperty(side, `${Math.round(offset)}px`)
                cell.style.zIndex = idx === 0 ? '7' : '3'
            })
        }

        /** Marks the column at the boundary of a pinned block: only that one casts the elevation shadow. */
        const markEdge = (i: number): void => {
            if (i < 0) return
            for (const cell of columnCells(i)) cell?.classList.add('rg-pin-edge')
        }

        let leftOff = 0
        let lastLeft = -1
        for (let i = 0; i < n; i++) {
            const s = sideOf[i]
            if ((s === 'lead' && anyLeft) || s === 'left') {
                pin(i, 'left', leftOff)
                leftOff += widths[i]
                lastLeft = i
            } else break
        }

        let rightOff = 0
        let firstRight = -1
        for (let i = n - 1; i >= 0; i--) {
            if (sideOf[i] === 'right') {
                pin(i, 'right', rightOff)
                rightOff += widths[i]
                firstRight = i
            } else break
        }

        markEdge(lastLeft)
        markEdge(firstRight)
    }

    /** Drops every sticky class and inline offset this feature applied, leaving the CSS in charge. */
    clear(): void {
        for (const cell of this.findAll('.rg-pin')) {
            if (!this.isOwn(cell)) continue
            cell.classList.remove('rg-pin', 'rg-pin-left', 'rg-pin-right', 'rg-pin-edge')
            cell.style.position = ''
            cell.style.left = ''
            cell.style.right = ''
            cell.style.zIndex = ''
        }
    }
}
