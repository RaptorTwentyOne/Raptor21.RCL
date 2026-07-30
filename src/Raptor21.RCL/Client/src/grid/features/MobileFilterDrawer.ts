import { GridFeature } from '../GridFeature'
import { closest, qsa } from '../../core/dom'

/**
 * Grid ids whose drawer is currently open.
 *
 * Outlives the component. Applying a filter swaps the whole region, which destroys this feature and
 * mounts a fresh one against the new markup, so an instance field would start empty every time and the
 * drawer would snap shut after each filter the user set. The grid id is the only identity that survives
 * the swap, so membership is keyed by it.
 */
const openFilterGrids = new Set<string>()

/** The one htmx call this feature makes; htmx is a global script, not an import. */
interface HtmxTrigger {
    trigger(el: Element, name: string): void
}

/**
 * The card-mode filter drawer.
 *
 * In card mode the column headers — and with them the funnel buttons that open each filter popup — are
 * not on screen, so the server re-uses those same `.rg-pop` elements by stacking them inside a
 * right-hand drawer that a floating action button opens. The drawer, its backdrop and the slide-in are
 * pure CSS hanging off `.rg-filters-open`; this feature only toggles that class, remembers it across
 * swaps, and clears every filter at once.
 */
export class MobileFilterDrawer extends GridFeature {
    override init(): void {
        // The swap re-mounts the component, so init is the first moment the new markup exists and the
        // open class can be put back.
        if (openFilterGrids.has(this.grid.gridId)) {
            this.el.classList.add('rg-filters-open')
        }

        this.on('click', event => this.onClick(event))
    }

    /**
     * The opener, the close affordances (backdrop, header ✕, Done) and Clear all sit inside the region,
     * so one scoped listener covers them. Each match is checked with isOwn, leaving the buttons of a
     * grid nested in a detail panel to that grid's own instance.
     */
    private onClick(event: Event): void {
        const opener = closest(event.target, '[data-rg-filter-open]')
        if (opener) {
            if (this.isOwn(opener)) this.setOpen(true)
            return
        }

        const closer = closest(event.target, '[data-rg-filter-close]')
        if (closer) {
            if (this.isOwn(closer)) this.setOpen(false)
            return
        }

        const clearAll = closest(event.target, '[data-rg-filter-clearall]')
        if (clearAll && this.isOwn(clearAll)) this.clearAll(clearAll)
    }

    private setOpen(open: boolean): void {
        this.el.classList.toggle('rg-filters-open', open)

        // Restoring is keyed by grid id. A region rendered without one still opens and closes normally;
        // it just cannot be put back after a swap.
        const gridId = this.grid.gridId
        if (!gridId) return
        if (open) openFilterGrids.add(gridId)
        else openFilterGrids.delete(gridId)
    }

    /**
     * Empties every filter control in the drawer and reloads the grid once.
     *
     * The controls are cleared silently, without dispatching change or input, because each carries its
     * own hx-post and letting them fire would issue one request per cleared filter. The drawer stays
     * open, surviving the swap this triggers through `openFilterGrids`.
     */
    private clearAll(trigger: Element): void {
        // Resolved from the button rather than by searching the region: a nested grid renders its own
        // drawer, which sits earlier in the document than this one, so a region-wide lookup would find
        // the wrong one.
        const drawer = closest(trigger, '.rg-filter-drawer')
        if (!drawer) return

        for (const input of qsa<HTMLInputElement>(drawer, '.rg-pop-input')) input.value = ''
        for (const check of qsa<HTMLInputElement>(drawer, '.rg-pop-check input:checked')) check.checked = false
        for (const select of qsa<HTMLSelectElement>(drawer, '.rg-pop-op')) select.selectedIndex = 0

        // Dropping the filters changes which rows exist, so the old page number no longer means
        // anything.
        const page = this.grid.form?.querySelector<HTMLInputElement>('input[name="page"]')
        if (page) page.value = '1'

        this.refresh()
    }

    private refresh(): void {
        const form = this.grid.form
        if (!form) return
        const htmx = (window as unknown as { htmx?: HtmxTrigger }).htmx
        htmx?.trigger(form, 'raptor:refresh')
    }
}
