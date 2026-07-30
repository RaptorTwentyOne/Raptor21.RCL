import { closest } from '../../core/dom'
import { GridFeature } from '../GridFeature'
import { paintSelection, selectionOf } from '../selection-store'

/**
 * Checkbox row selection: the per-grid key set, the header select-all, the "N selected / clear" bar,
 * and re-applying all of it to freshly rendered rows.
 *
 * Nothing here is submitted with the grid form: the checkboxes are unnamed, so a filter/sort/page POST
 * does not carry the selection. Callers read it through `window.raptorGrid.getSelection(gridId)` when
 * they run a bulk action.
 */
export class RowSelection extends GridFeature {
    init(): void {
        // Every path below keys off the grid id; with no id there is no set to accumulate into.
        if (!this.grid.gridId) return

        this.on('change', event => this.handleChange(event))
        this.on('click', event => this.handleClick(event))

        // A swap of the whole region re-mounts this feature, and the final syncUi() below is the
        // re-apply pass for it. Swaps that target a single <tr> — a virtual-scroll block append, an
        // inline-edit save — leave this instance in place, and those rows arrive unchecked from the
        // server, so the set is re-applied as they settle.
        this.on('htmx:afterSettle', event => {
            if (this.isOwn(event.target)) this.syncUi()
        })

        this.syncUi()
    }

    /** Re-applies the set to the DOM. The painting itself is shared with the window API. */
    private syncUi(): void {
        paintSelection(this.el, this.grid.gridId)
    }

    private handleChange(event: Event): void {
        const rowBox = closest<HTMLInputElement>(event.target, '.rg-sel-row')
        if (rowBox) {
            if (!this.isOwn(rowBox)) return
            if (rowBox.checked) this.selected.add(rowBox.value)
            else this.selected.delete(rowBox.value)
            this.syncUi()
            return
        }

        const allBox = closest<HTMLInputElement>(event.target, '.rg-sel-all')
        if (!allBox || !this.isOwn(allBox)) return
        // Select-all covers the rows currently rendered, matching the header's "select all on this page".
        for (const box of this.rowBoxes()) {
            if (allBox.checked) this.selected.add(box.value)
            else this.selected.delete(box.value)
        }
        this.syncUi()
    }

    private handleClick(event: Event): void {
        const clear = closest(event.target, '[data-rg-selclear]')
        if (!clear || !this.isOwn(clear)) return
        this.selected.clear()
        this.syncUi()
    }

    /** This grid's set, shared with any later instance for the same grid. */
    private get selected(): Set<string> {
        return selectionOf(this.grid.gridId)
    }

    private rowBoxes(): HTMLInputElement[] {
        return this.ownAll<HTMLInputElement>('.rg-sel-row')
    }

    /**
     * Descendants that belong to this grid. A master-detail panel can host a whole other grid, and a
     * plain descendant query would sweep its checkboxes into this grid's selection and its tri-state.
     */
    private ownAll<T extends Element = HTMLElement>(selector: string): T[] {
        return this.findAll<T>(selector).filter(node => node.closest('.raptor-grid') === this.el)
    }
}
