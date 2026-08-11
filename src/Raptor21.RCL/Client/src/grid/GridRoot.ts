import { GridComponent } from './GridComponent'
import { ColumnPinning } from './features/ColumnPinning'
import { ColumnReorder } from './features/ColumnReorder'
import { ColumnSizing } from './features/ColumnSizing'
import { FilterPopups } from './features/FilterPopups'
import { GridLayout } from './features/GridLayout'
import { InlineEdit } from './features/InlineEdit'
import { LoadErrors } from './features/LoadErrors'
import { LoadingSkeleton } from './features/LoadingSkeleton'
import { MasterDetail } from './features/MasterDetail'
import { MobileFilterDrawer } from './features/MobileFilterDrawer'
import { RowReorder } from './features/RowReorder'
import { RowSelection } from './features/RowSelection'
import { VirtualScroll } from './features/VirtualScroll'

/**
 * The grid's composition root — the class the registry mounts for `data-rg-component="grid"`.
 *
 * Nothing here does any work itself; it declares which behaviours a grid has.
 *
 * Order matters in one respect: features initialise in registration order, and GridLayout's first pass
 * drives ColumnSizing and ColumnPinning through `grid.feature(...)`. Both must therefore be registered
 * before it, or that first pass silently finds nothing and the grid renders unsized.
 */
export class GridRoot extends GridComponent {
    constructor(el: HTMLElement) {
        super(el)

        this.use(FilterPopups)
            .use(RowSelection)
            .use(MasterDetail)
            .use(MobileFilterDrawer)
            .use(VirtualScroll)
            .use(LoadErrors)
            .use(LoadingSkeleton)
            .use(InlineEdit)
            .use(ColumnSizing)
            .use(ColumnPinning)
            .use(ColumnReorder)
            .use(RowReorder)
            .use(GridLayout)
    }
}
