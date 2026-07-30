import { GridFeature } from '../GridFeature'
import { closest, qsa } from '../../core/dom'
import { closeAllPopups } from './FilterPopups'

/** The fields this feature reads off an htmx event. */
interface HtmxEventDetail {
    readonly successful?: boolean
    readonly pathInfo?: { readonly requestPath?: string }
    readonly xhr?: XMLHttpRequest
    readonly target?: EventTarget | null
}

function detailOf(event: Event): HtmxEventDetail | undefined {
    return (event as CustomEvent<HtmxEventDetail | undefined>).detail ?? undefined
}

/** An editor currently open on screen. */
interface EditState {
    readonly td: HTMLElement
    /** The cell's markup from before the editor replaced it, put back on cancel. */
    readonly originalHtml: string
    readonly field: string
    /** The value the editor opened with. A commit that matches it is not worth a request. */
    readonly value: string
}

/**
 * Identifies the save response among every other request this region makes. The endpoint is named by
 * the server (`data-rg-cell-endpoint`) and only its tail is fixed, so the path is matched rather than
 * compared — allowing for a query string, which is why the match is anchored on `?` or end of string
 * instead of being a plain `endsWith`.
 */
const CELL_SAVE_PATH = /\/cell(?:\?|$)/

/** A failed save shows what the server said, but an error message is not a place for a stack trace. */
const MAX_ERROR_LENGTH = 300

/**
 * Inline cell editing.
 *
 * Double-clicking an editable cell replaces it with a text input; Enter or blur saves, Esc cancels. The
 * save goes to an endpoint that patches one field and answers with just the updated `<tr>`, which htmx
 * swaps in, so a save costs a row rather than a page and the rendered row always comes from the server.
 * A non-2xx re-opens the editor with the server's message. Nothing here is a permission check: the
 * server must re-enforce both the permission and the field allowlist, since all of it is reachable from
 * a console.
 *
 * The editor lives in the DOM and nowhere else, so the only state held between events is the cell being
 * edited and, once a save is in flight, what was typed into it. That state is per-grid: a grid inside a
 * detail panel is a separate component with its own editor.
 */
export class InlineEdit extends GridFeature {
    private editState: EditState | null = null
    private savingTd: HTMLElement | null = null
    private savingValue = ''

    override init(): void {
        this.on('dblclick', event => this.onDoubleClick(event))

        // Capture phase on the document, so Enter and Esc reach nothing else while an editor is open:
        // Enter would otherwise submit the filter form and reload the region out from under the save,
        // and Esc would close a popup instead of the editor.
        this.onDocument('keydown', event => this.onKeyDown(event as KeyboardEvent), { capture: true })

        // Focus leaving the input is a commit. Capture keeps it ahead of anything else that reacts to
        // the cell losing focus.
        this.on('focusout', event => this.onFocusOut(event), { capture: true })

        this.on('htmx:afterRequest', event => this.onAfterRequest(event))

        // On the document: the swap of an enclosing region is fired on an ancestor and never reaches a
        // listener bound here, yet for a grid in a detail panel that is the swap that removes the editor.
        this.onDocument('htmx:beforeSwap', event => this.onBeforeSwap(event))
    }

    private onDoubleClick(event: Event): void {
        const td = closest<HTMLElement>(event.target, 'td[data-rg-edit]')
        if (!td || !this.isOwn(td) || td.classList.contains('rg-editing')) return
        // Otherwise the double-click selects the cell text under the editor.
        event.preventDefault()
        this.beginEdit(td)
    }

    private beginEdit(td: HTMLElement): void {
        // One editor per grid: committing replaces the whole row, so a second editor in the same grid
        // could be swapped away mid-typing.
        if (this.editState || td.classList.contains('rg-editing')) return
        if (td.getAttribute('data-rg-edit') !== 'text') return

        // Filter popups are position:fixed off their funnel, so one left open would hang over the cell.
        closeAllPopups()

        const originalHtml = td.innerHTML
        // Seeded from the rendered text rather than a data attribute, so a formatted cell is edited in
        // its formatted form and the server parses it back.
        const seed = (td.textContent ?? '').trim()
        const input = this.createInput(seed)

        td.innerHTML = ''
        td.appendChild(input)
        td.classList.add('rg-editing')
        this.editState = { td, originalHtml, field: td.getAttribute('data-rg-field') ?? '', value: seed }
        input.focus()
        input.select()
    }

    private cancelEdit(): void {
        const state = this.editState
        if (!state) return

        // Cleared before the markup goes back: restoring it removes the focused input, which fires
        // focusout, which commits whenever editState is still set.
        this.editState = null
        state.td.classList.remove('rg-editing', 'rg-saving')
        state.td.innerHTML = state.originalHtml
    }

    private commitEdit(): void {
        const state = this.editState
        if (!state) return

        const { td, field } = state
        const input = td.querySelector<HTMLInputElement>('input.rg-edit-input')
        const newValue = input ? input.value : ''
        // An unchanged value is not a save. Compared trimmed, matching how the seed was trimmed, so
        // stray whitespace around an untouched value does not cost a request.
        if (newValue.trim() === state.value.trim()) {
            this.cancelEdit()
            return
        }

        const tr = td.closest('tr')
        const rowKey = tr?.getAttribute('data-row-key')
        const htmx = window.htmx
        const gridId = this.grid.gridId
        // Nothing identifies the row, or htmx never loaded: there is no request to make, so close the
        // editor rather than leave it open over an edit that can never land.
        if (!gridId || !tr || !rowKey || !htmx) {
            this.cancelEdit()
            return
        }

        // The row comes back re-rendered, so it has to come back in the column order now on screen.
        const colOrder = this.colOrder()

        // In flight from here: editState is cleared because the DOM is about to be replaced, and only
        // what re-opening the editor would need after a failure is kept.
        this.editState = null
        this.savingTd = td
        this.savingValue = newValue
        td.classList.add('rg-saving')
        if (input) input.disabled = true

        // The endpoint is server-rendered onto the region, so the client never hard-codes a route. The
        // fallback is the convention the library ships with.
        const endpoint = this.el.getAttribute('data-rg-cell-endpoint') || `/_grid/${gridId}/cell`
        void htmx.ajax('post', endpoint, {
            source: tr,
            target: tr,
            swap: 'outerHTML',
            values: { rowKey, field, value: newValue, colOrder },
        })
    }

    /**
     * The column order the server round-trips through the form.
     *
     * The form wraps the table, so a grid rendered into a detail panel has its own hidden input nested
     * inside this one's; the input is matched by ownership rather than document order.
     */
    private colOrder(): string {
        const form = this.grid.form
        if (!form) return ''
        for (const input of qsa<HTMLInputElement>(form, 'input[name="colOrder"]')) {
            if (this.isOwn(input)) return input.value
        }
        return ''
    }

    /** Re-opens the editor over a failed save, with what was typed and why it was rejected. */
    private reopenWithError(td: HTMLElement, value: string, message: string): void {
        td.classList.remove('rg-saving')
        td.classList.add('rg-editing')
        td.innerHTML = ''

        const input = this.createInput(value)
        const error = document.createElement('span')
        error.className = 'rg-edit-error'
        error.textContent = message
        td.appendChild(input)
        td.appendChild(error)

        // There is no original markup left to restore: the cell was emptied when the editor first opened
        // and the request that failed brought no row back. Cancelling from here therefore leaves the cell
        // blank until the next region swap re-renders the row from the server.
        this.editState = { td, originalHtml: '', field: td.getAttribute('data-rg-field') ?? '', value }
        input.focus()
        input.select()
    }

    private onKeyDown(event: KeyboardEvent): void {
        if (!this.ownsEditor(event.target)) return

        if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            this.commitEdit()
        } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            this.cancelEdit()
        }
    }

    private onFocusOut(event: Event): void {
        // ownsEditor requires an open editor, so the focusout that committing itself causes finds
        // editState already null and does not save twice.
        if (this.ownsEditor(event.target)) this.commitEdit()
    }

    /**
     * True when the event came from the editor this feature has open.
     *
     * The `.rg-edit-input` class alone is not enough: a key pressed in a detail panel's editor reaches
     * this handler too, and only the cell recorded in editState identifies the owner.
     */
    private ownsEditor(target: EventTarget | null): boolean {
        const state = this.editState
        if (!state) return false
        const input = closest<HTMLElement>(target, '.rg-edit-input')
        return input != null && state.td.contains(input)
    }

    /**
     * The save's outcome. On success htmx has already swapped the fresh row in and there is nothing left
     * to do; anything else re-opens the editor so the edit is not silently lost.
     */
    private onAfterRequest(event: Event): void {
        const td = this.savingTd
        if (!td) return

        // On failure the event bubbles from the row that made the request; on success that row has been
        // replaced, so htmx re-fires from the nearest ancestor still in the document. Either way it is
        // inside this region, and a detail panel's grid saving its own cell bubbles through here too.
        if (!this.isOwn(event.target)) return

        const detail = detailOf(event)
        const path = detail?.pathInfo?.requestPath || detail?.xhr?.responseURL || ''
        // Other requests from this region (filter, sort, page, a detail panel loading) are not saves.
        if (!CELL_SAVE_PATH.test(path)) return

        this.savingTd = null
        if (detail?.successful) return

        this.reopenWithError(td, this.savingValue, (detail?.xhr?.responseText || 'Update failed.').slice(0, MAX_ERROR_LENGTH))
    }

    /**
     * A region swap — a filter, a sort, a page — discards any open editor.
     *
     * The swap removes the focused input, and a browser that fires focusout on removal would commit an
     * edit against a row that is already gone. Cancelling first clears editState, which makes that
     * focusout a no-op.
     *
     * The containment test rather than an identity one covers a grid inside a detail panel, which is
     * removed by the enclosing region's swap. A nested grid's own swap is left to that grid's own
     * instance of this feature.
     */
    private onBeforeSwap(event: Event): void {
        if (!this.editState) return

        const target = detailOf(event)?.target
        // Only a whole region counts. The row-level swap of a successful save lands here too, with a
        // <tr> as its target.
        if (!(target instanceof Element) || !target.classList.contains('raptor-grid')) return

        if (target === this.el || target.contains(this.el)) this.cancelEdit()
    }

    private createInput(value: string): HTMLInputElement {
        const input = document.createElement('input')
        input.type = 'text'
        input.className = 'rg-edit-input'
        input.value = value
        return input
    }
}
