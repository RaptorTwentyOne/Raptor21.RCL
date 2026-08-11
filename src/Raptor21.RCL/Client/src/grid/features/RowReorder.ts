import { closest } from '../../core/dom'
import { GridFeature } from '../GridFeature'
import { closeAllPopups } from './FilterPopups'

/** The fields this feature reads off an htmx event. */
interface HtmxEventDetail {
    readonly successful?: boolean
    readonly pathInfo?: { readonly requestPath?: string }
    readonly xhr?: XMLHttpRequest
}

function detailOf(event: Event): HtmxEventDetail | undefined {
    return (event as CustomEvent<HtmxEventDetail | undefined>).detail ?? undefined
}

/**
 * Reordering rows by dragging the per-row handle.
 *
 * The new order is server-authoritative: nothing is moved in the DOM here, mirroring ColumnReorder.
 * The drop names the slot the row was dropped into — `beforeKey` is the row it now sits ABOVE,
 * `afterKey` the row it sits BELOW — and posts it to the endpoint the server rendered onto the region
 * (`data-rg-reorder-endpoint`). On success the server re-renders the whole region itself (retarget,
 * the GridCellSaved pattern) or answers with a refresh trigger; on failure nothing was touched
 * locally, so the form is re-posted and the grid returns to the server's truth. Either way the rows
 * on screen always come from the server.
 *
 * Drags start only from the handle (`[data-rg-drag]`), never from the row itself: a row is full of
 * clickable things — selection boxes, expand buttons, editable cells — and a draggable row would turn
 * every slightly-moved click into a drag. When an active sort or filter makes a manual order
 * meaningless, the server renders the handle without `data-rg-drag` and without `draggable`
 * (`rg-drag-off`), so a drag can never start and no client-side guard is needed here.
 */
export class RowReorder extends GridFeature {
    /**
     * The dragged row's key, or null when no drag of this grid's rows is in flight.
     *
     * Each grid owns an instance, so a non-null field already means the drag belongs to this grid; the
     * row under the cursor is checked with `isOwn()`.
     */
    private dragKey: string | null = null

    /** The endpoint of the reorder POST in flight — how its afterRequest is told apart from others. */
    private pendingEndpoint: string | null = null

    init(): void {
        this.on('dragstart', event => this.handleDragStart(event))
        this.on('dragover', event => this.handleDragOver(event))
        this.on('drop', event => this.handleDrop(event))
        this.on('dragend', () => this.handleDragEnd())

        this.on('htmx:afterRequest', event => this.onAfterRequest(event))
    }

    // --- drag lifecycle -----------------------------------------------------

    private handleDragStart(event: Event): void {
        if (!(event instanceof DragEvent)) return

        const handle = closest<HTMLElement>(event.target, '[data-rg-drag]')
        if (!handle || !this.isOwn(handle)) return

        const tr = handle.closest('tr')
        const key = tr?.getAttribute('data-row-key')
        if (!tr || !key) return

        this.dragKey = key
        // Filter popups are position:fixed off their funnel, so one left open would hang over the drag.
        closeAllPopups()
        tr.classList.add('rg-dragging-row')

        const transfer = event.dataTransfer
        if (transfer) {
            transfer.effectAllowed = 'move'
            try {
                transfer.setData('text/plain', key)
            } catch {
                /* engines that reject setData here still drag fine — the payload is never read back */
            }
        }
    }

    private handleDragOver(event: Event): void {
        if (!(event instanceof DragEvent) || !this.dragKey) return

        const tr = closest<HTMLElement>(event.target, 'tr[data-row-key]')
        if (!tr || !this.isOwn(tr)) return

        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

        this.clearDropIndicators()
        if (tr.getAttribute('data-row-key') === this.dragKey) return

        // Above or below the row's midpoint decides which edge the indicator marks — the vertical
        // twin of ColumnReorder's midpoint test, minus the RTL branch: rows stack the same way in
        // either direction.
        const rect = tr.getBoundingClientRect()
        const above = event.clientY < rect.top + rect.height / 2

        tr.classList.add(above ? 'rg-drop-above' : 'rg-drop-below')
        tr.dataset.rgAbove = above ? '1' : '0'
    }

    private handleDrop(event: Event): void {
        if (!(event instanceof DragEvent)) return

        const dragKey = this.dragKey
        if (!dragKey) return

        const tr = closest<HTMLElement>(event.target, 'tr[data-row-key]')
        if (!tr || !this.isOwn(tr)) return
        event.preventDefault()

        const targetKey = tr.getAttribute('data-row-key')
        const above = tr.dataset.rgAbove === '1'
        this.clearDropIndicators()
        if (!targetKey || targetKey === dragKey) return

        const keys = this.rowKeys()
        const targetIndex = keys.indexOf(targetKey)
        if (targetIndex < 0 || !keys.includes(dragKey)) return

        // The slot is named half-open on both sides so the server resolves it against ITS order, not
        // the client's: beforeKey is the row the drop lands above, afterKey the row it lands below. A
        // drop below the last row has no beforeKey — the server appends after afterKey.
        const beforeKey = above ? targetKey : targetIndex + 1 < keys.length ? keys[targetIndex + 1] : ''
        const afterKey = above ? (targetIndex > 0 ? keys[targetIndex - 1] : '') : targetKey

        // The slot next to the dragged row is the slot it is already in — not a move.
        if (beforeKey === dragKey || afterKey === dragKey) return

        this.postReorder(dragKey, beforeKey, afterKey)
    }

    private handleDragEnd(): void {
        for (const row of this.ownAll('tr.rg-dragging-row')) row.classList.remove('rg-dragging-row')
        this.clearDropIndicators()
        this.dragKey = null
    }

    // --- request -------------------------------------------------------------

    private postReorder(rowKey: string, beforeKey: string, afterKey: string): void {
        const endpoint = this.el.getAttribute('data-rg-reorder-endpoint')
        const htmx = window.htmx
        const source = this.ownRows().find(row => row.getAttribute('data-row-key') === rowKey)
        if (!endpoint || !htmx || !source) return

        this.pendingEndpoint = endpoint
        // `source` sits inside the state form, so the POST carries the page, sort, filters and column
        // order automatically and the server re-renders against the state on screen. No target/swap:
        // on success the server retargets the whole region itself (or answers with a refresh
        // trigger), and a 4xx swaps nothing for onAfterRequest to recover from.
        void htmx.ajax('post', endpoint, { source, values: { rowKey, beforeKey, afterKey } })
    }

    /**
     * The reorder's outcome. Success needs nothing: the response has already replaced or refreshed
     * the region. Anything else means the drop indicator promised a move that never happened — the
     * rows themselves were never touched locally — so the form is re-posted and the grid settles back
     * on the server's truth.
     */
    private onAfterRequest(event: Event): void {
        const endpoint = this.pendingEndpoint
        if (!endpoint || !this.isOwn(event.target)) return

        const detail = detailOf(event)
        // Other requests from this region (filter, sort, page, a cell save) are not reorders.
        // `includes` rather than equality because the fallback responseURL is absolute while the
        // endpoint the server rendered is usually not.
        const path = detail?.pathInfo?.requestPath || detail?.xhr?.responseURL || ''
        if (!path.includes(endpoint)) return

        this.pendingEndpoint = null
        if (detail?.successful) return

        const form = this.grid.form
        if (form) window.htmx?.trigger(form, 'raptor:refresh')
    }

    // --- dom helpers --------------------------------------------------------

    private clearDropIndicators(): void {
        for (const marked of this.ownAll('.rg-drop-above, .rg-drop-below')) {
            marked.classList.remove('rg-drop-above', 'rg-drop-below')
            delete marked.dataset.rgAbove
        }
    }

    /** This grid's data rows, in rendered order. The sentinel and detail rows carry no key. */
    private ownRows(): HTMLElement[] {
        return this.findAll('tbody tr[data-row-key]').filter(row => this.isOwn(row))
    }

    private rowKeys(): string[] {
        return this.ownRows()
            .map(row => row.getAttribute('data-row-key'))
            .filter((key): key is string => !!key)
    }

    /** findAll, minus anything that actually belongs to a grid nested in a detail panel. */
    private ownAll(selector: string): HTMLElement[] {
        return this.findAll<HTMLElement>(selector).filter(el => this.isOwn(el))
    }
}
