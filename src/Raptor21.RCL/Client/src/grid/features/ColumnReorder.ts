import { closest, qsa, readStore, writeStore } from '../../core/dom'
import { GridFeature } from '../GridFeature'
import { closeAllPopups } from './FilterPopups'

/** Minimal view of the htmx global — this feature only ever re-posts the grid form. */
interface HtmxApi {
    trigger(target: Element, event: string): void
}

function htmxApi(): HtmxApi | null {
    return (window as unknown as { htmx?: HtmxApi }).htmx ?? null
}

function colOrderKey(gridId: string): string {
    return `rg:colorder:${gridId}`
}

/**
 * Grid ids whose stored order has already been reconciled against the server-rendered one.
 *
 * Reconciling is a load-time correction, not a per-render one: it re-posts the form, which swaps the
 * region and mounts a fresh component, which would reconcile again. Keying the attempt to the page load
 * bounds that to a single pass, so a server that does not honour colOrder costs one wasted request
 * rather than an endless loop.
 */
const reconciledGrids = new Set<string>()

/**
 * Reordering columns by dragging a header.
 *
 * The new order is server-authoritative: nothing is moved in the DOM here. The drop computes the order,
 * writes it to localStorage and to the hidden `colOrder` input the server round-trips, then re-posts the
 * form so the region comes back rendered in that order. Both stores are needed: the input carries the
 * order through every subsequent filter/sort/page request, while storage is what survives a fresh page
 * load.
 */
export class ColumnReorder extends GridFeature {
    /**
     * The column being dragged, or null when no drag of this grid's headers is in flight.
     *
     * Each grid owns an instance, so a non-null field already means the drag belongs to this grid; the
     * header under the cursor is checked with `isOwn()`.
     */
    private dragField: string | null = null

    init(): void {
        this.on('dragstart', event => this.handleDragStart(event))
        this.on('dragover', event => this.handleDragOver(event))
        this.on('drop', event => this.handleDrop(event))
        this.on('dragend', () => this.handleDragEnd())

        this.reconcile()
    }

    // --- drag lifecycle -----------------------------------------------------

    private handleDragStart(event: Event): void {
        if (!(event instanceof DragEvent)) return

        const th = closest<HTMLElement>(event.target, 'th.rg-reorder')
        if (!th || !this.isOwn(th)) return

        this.dragField = th.getAttribute('data-rg-col')
        closeAllPopups()
        th.classList.add('rg-dragging')

        const transfer = event.dataTransfer
        if (transfer) {
            transfer.effectAllowed = 'move'
            try {
                transfer.setData('text/plain', this.dragField ?? '')
            } catch {
                /* engines that reject setData here still drag fine — the payload is never read back */
            }
        }
    }

    private handleDragOver(event: Event): void {
        if (!(event instanceof DragEvent) || !this.dragField) return

        const th = closest<HTMLElement>(event.target, 'th.rg-reorder')
        if (!th || !this.isOwn(th)) return

        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

        this.clearDropIndicators()
        if (th.getAttribute('data-rg-col') === this.dragField) return

        const rect = th.getBoundingClientRect()
        const rtl = getComputedStyle(th).direction === 'rtl'
        const middle = rect.left + rect.width / 2
        const beforeLogical = rtl ? event.clientX > middle : event.clientX < middle
        const physLeft = rtl ? !beforeLogical : beforeLogical

        th.classList.add(physLeft ? 'rg-drop-left' : 'rg-drop-right')
        th.dataset.sgBefore = beforeLogical ? '1' : '0'
    }

    private handleDrop(event: Event): void {
        if (!(event instanceof DragEvent)) return

        const dragField = this.dragField
        const gridId = this.grid.gridId
        if (!dragField || !gridId) return

        const th = closest<HTMLElement>(event.target, 'th.rg-reorder')
        if (!th || !this.isOwn(th)) return
        event.preventDefault()

        const targetField = th.getAttribute('data-rg-col')
        if (targetField === dragField) return
        const before = th.dataset.sgBefore === '1'
        const current = this.orderFields()

        const order = current.slice()
        const from = order.indexOf(dragField)
        if (from >= 0) order.splice(from, 1)
        let to = targetField ? order.indexOf(targetField) : order.length
        if (to < 0) to = order.length
        if (!before) to += 1
        order.splice(to, 0, dragField)

        this.clearDropIndicators()
        if (order.join(',') !== current.join(',')) this.applyOrder(order)
    }

    private handleDragEnd(): void {
        for (const th of this.ownAll('.rg-dragging')) th.classList.remove('rg-dragging')
        this.clearDropIndicators()
        this.dragField = null
    }

    // --- order -------------------------------------------------------------

    /**
     * Applies a new order: persist it, echo it into the hidden input the server reads, and re-post.
     *
     * The refresh is fired even when the input is missing, so a grid whose form does not round-trip
     * colOrder still reloads rather than appearing to ignore the drop.
     */
    private applyOrder(order: string[]): void {
        writeStore(colOrderKey(this.grid.gridId), order)

        const form = this.grid.form
        if (!form) return

        const input = qsa<HTMLInputElement>(form, 'input[name="colOrder"]').find(candidate => this.isOwn(candidate))
        if (input) input.value = order.join(',')

        htmxApi()?.trigger(form, 'raptor:refresh')
    }

    /**
     * Re-applies a stored order once per page load, when it differs from what the server rendered.
     *
     * The server renders the definition order until a request carries colOrder, so a saved order would
     * otherwise be lost on every fresh navigation to the page. Columns added to the definition since the
     * order was saved keep their server position at the end rather than being dropped.
     */
    private reconcile(): void {
        const gridId = this.grid.gridId
        if (!gridId || reconciledGrids.has(gridId)) return
        reconciledGrids.add(gridId)

        const stored = readStore<unknown>(colOrderKey(gridId), [])
        if (!Array.isArray(stored)) return
        const saved = stored.filter((field): field is string => typeof field === 'string')
        if (saved.length === 0) return

        const current = this.orderFields()
        const present = new Set(current)
        const applied = saved.filter(field => present.has(field)).concat(current.filter(field => !saved.includes(field)))

        if (applied.join(',') !== current.join(',')) this.applyOrder(applied)
    }

    /** The reorderable columns, in their current rendered order. Headers with no field are skipped. */
    private orderFields(): string[] {
        return this.ownAll('thead th.rg-reorder')
            .map(th => th.getAttribute('data-rg-col'))
            .filter((field): field is string => !!field)
    }

    // --- dom helpers --------------------------------------------------------

    private clearDropIndicators(): void {
        for (const marked of this.ownAll('.rg-drop-left, .rg-drop-right')) {
            marked.classList.remove('rg-drop-left', 'rg-drop-right')
        }
    }

    /** findAll, minus anything that actually belongs to a grid nested in a detail panel. */
    private ownAll(selector: string): HTMLElement[] {
        return this.findAll<HTMLElement>(selector).filter(el => this.isOwn(el))
    }
}
