import { GridFeature } from '../GridFeature'
import { closest, cssEscape } from '../../core/dom'

/** Breathing room between a popup and the viewport edge it would otherwise run past. */
const EDGE_GAP = 8

/** Gap between the funnel and the popup floating off it. */
const ANCHOR_GAP = 4

/**
 * Dismisses every open popup on the page, in any grid.
 *
 * A free function rather than a method, so beginning a resize, a reorder drag or a cell edit can clear
 * the popups without the acting grid having registered this feature.
 */
export function closeAllPopups(): void {
    for (const pop of document.querySelectorAll('.raptor-grid .rg-pop.rg-open')) {
        pop.classList.remove('rg-open')
    }
}

/**
 * Header filter popups — the funnel button that opens a per-column filter panel.
 *
 * The panels and their inputs are server-rendered inside the grid form and carry `hx-preserve`, so the
 * filtering itself is htmx posting straight from those inputs and the open panel survives the region
 * swap that follows. This feature owns only the chrome around that: which panel is open, where it
 * floats, and clearing one column's filter.
 *
 * In card mode the same panels are re-used as stacked sections inside the mobile filter drawer, where
 * CSS shows them regardless of `.rg-open`. Opening and positioning are inert there — the funnels are
 * not rendered — but clearing a single column still runs through here.
 */
export class FilterPopups extends GridFeature {
    init(): void {
        this.on('click', event => this.onClick(event))

        // Dismissal escapes the element: a click anywhere on the page, this grid or not, closes an open
        // popup.
        this.onDocument('click', event => this.onDocumentClick(event))

        // Escape closes the popup wherever focus happens to be. Bubble phase, so a cancelled inline edit
        // — which takes Escape in the capture phase and stops propagation — does not also reach here.
        this.onDocument('keydown', event => {
            if ((event as KeyboardEvent).key === 'Escape') this.closeAll()
        })

        // A popup is position:fixed at coordinates measured from its funnel, so any scroll or resize
        // would leave it stranded over unrelated content. Capture, because scroll does not bubble and
        // the mover is usually the grid's own scroll viewport. A set popup's option list scrolls too, so
        // scrolls originating inside a popup are skipped.
        this.onWindow('scroll', event => {
            if (closest(event.target, '.rg-pop')) return
            this.closeAll()
        }, { capture: true })
        this.onWindow('resize', () => this.closeAll())
    }

    /**
     * Closes every popup belonging to this grid, leaving those of a grid nested in a detail panel alone.
     *
     * Callable by other features, which dismiss the popup when they start a column resize, a header
     * reorder drag or a cell edit.
     */
    closeAll(): void {
        for (const pop of this.findAll('.rg-pop.rg-open')) {
            if (this.isOwn(pop)) pop.classList.remove('rg-open')
        }
    }

    private onClick(event: Event): void {
        const funnel = closest<HTMLElement>(event.target, '[data-rg-toggle]')
        if (funnel && this.isOwn(funnel)) {
            event.preventDefault()
            this.toggle(funnel)
            return
        }

        const clear = closest<HTMLElement>(event.target, '[data-rg-clear]')
        if (clear && this.isOwn(clear)) this.clearFilter(clear)
    }

    private onDocumentClick(event: Event): void {
        // A click inside any popup, including its own Clear button, is interaction rather than
        // dismissal.
        if (closest(event.target, '.rg-pop')) return

        // This grid's own funnel is handled by the element-scoped listener; document sees the event
        // afterwards, and would otherwise dismiss the popup the click just opened.
        const funnel = closest<HTMLElement>(event.target, '[data-rg-toggle]')
        if (funnel && this.isOwn(funnel)) return

        // Everything else closes this grid's popups, including a funnel in a sibling or nested grid.
        this.closeAll()
    }

    private toggle(funnel: HTMLElement): void {
        const pop = this.findPopup(funnel.getAttribute('data-rg-toggle') || '')
        if (!pop) return

        // Read the state before closing: clicking the funnel of the open popup is what closes it.
        const wasOpen = pop.classList.contains('rg-open')
        this.closeAll()
        if (wasOpen) return

        this.position(pop, funnel)
        pop.classList.add('rg-open')
        pop.querySelector<HTMLInputElement>('.rg-pop-input')?.focus()
    }

    /**
     * Places a popup under its funnel: right-aligned to it, flipped above when it would fall off the
     * bottom, and clamped so neither edge leaves the viewport.
     */
    private position(pop: HTMLElement, anchor: Element): void {
        const rect = anchor.getBoundingClientRect()

        // The popup is display:none until .rg-open, so it has no size to read while closed. Open it
        // behind visibility:hidden to measure, then restore both, so the measurement pass never shows it
        // at the coordinates left over from the previous opening.
        const previousVisibility = pop.style.visibility
        pop.style.visibility = 'hidden'
        pop.classList.add('rg-open')
        const width = pop.offsetWidth
        const height = pop.offsetHeight
        pop.classList.remove('rg-open')
        pop.style.visibility = previousVisibility

        let left = Math.min(rect.right - width, window.innerWidth - width - EDGE_GAP)
        if (left < EDGE_GAP) left = EDGE_GAP

        let top = rect.bottom + ANCHOR_GAP
        if (top + height > window.innerHeight - EDGE_GAP) {
            top = Math.max(EDGE_GAP, rect.top - height - ANCHOR_GAP)
        }

        pop.style.left = `${Math.round(left)}px`
        pop.style.top = `${Math.round(top)}px`
    }

    /**
     * Empties one column's filter and lets the popup's own htmx bindings re-post the form.
     *
     * The two filter shapes clear differently. A set filter unchecks every box but dispatches `change`
     * from a single one, because every box posts on change and firing them all would send one request
     * per option. A text/number/date filter resets the operator silently — an operator with no value
     * filters nothing — then dispatches both `input` and `change` from the value field, because the
     * server binds a different one of the two per filter type.
     */
    private clearFilter(button: HTMLElement): void {
        const pop = this.findPopup(button.getAttribute('data-rg-clear') || '')
        if (!pop) return

        const checked = [...pop.querySelectorAll<HTMLInputElement>('.rg-pop-check input:checked')]
        if (checked.length > 0) {
            for (const box of checked) box.checked = false
            checked[0].dispatchEvent(new Event('change', { bubbles: true }))
        } else {
            const operator = pop.querySelector<HTMLSelectElement>('.rg-pop-op')
            const input = pop.querySelector<HTMLInputElement>('.rg-pop-input')
            if (operator) operator.selectedIndex = 0
            // An already-empty field has nothing to clear, and dispatching anyway would re-post the
            // identical query.
            if (input && input.value !== '') {
                input.value = ''
                input.dispatchEvent(new Event('input', { bubbles: true }))
                input.dispatchEvent(new Event('change', { bubbles: true }))
            }
        }

        pop.classList.remove('rg-open')
    }

    /**
     * The popup for a column key. Column keys are unique within a grid but not across grids, so a
     * nested grid's panel can match the selector first — ownership, not document order, decides.
     */
    private findPopup(field: string): HTMLElement | null {
        return this.findAll(`[data-rg-pop="${cssEscape(field)}"]`).find(pop => this.isOwn(pop)) ?? null
    }
}
