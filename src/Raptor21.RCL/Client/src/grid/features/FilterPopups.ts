import { GridFeature } from '../GridFeature'
import { closest, cssEscape } from '../../core/dom'

/** Breathing room between a popup and the viewport edge it would otherwise run past. */
const EDGE_GAP = 8

/** Gap between the funnel and the popup floating off it. */
const ANCHOR_GAP = 4

/**
 * Opens or closes one popup AND keeps its trigger's `aria-expanded` truthful.
 *
 * The two have to move together or the attribute becomes a lie, which is worse than not having it: a
 * screen-reader user is told the panel is closed while it is on screen. Every real open/close path goes
 * through here. The trigger is found by `aria-controls` matching the panel's own id rather than by the
 * column key, because a grid nested in a detail panel can carry the same key as its parent and the ids
 * are already unique per grid.
 */
function setOpen(pop: Element, open: boolean): void {
    pop.classList.toggle('rg-open', open)
    if (!pop.id) return
    const trigger = document.querySelector(`[aria-controls="${CSS.escape(pop.id)}"]`)
    trigger?.setAttribute('aria-expanded', open ? 'true' : 'false')
}

/**
 * Dismisses every open popup on the page, in any grid.
 *
 * A free function rather than a method, so beginning a resize, a reorder drag or a cell edit can clear
 * the popups without the acting grid having registered this feature.
 */
export function closeAllPopups(): void {
    for (const pop of document.querySelectorAll('.raptor-grid .rg-pop.rg-open')) {
        setOpen(pop, false)
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

        // The set popup's search box filters its option labels client-side. Nothing here posts: the
        // input carries no name and no hx-trigger; only what the user CHECKS reaches the server.
        this.on('input', event => this.onSetSearch(event))

        // CAPTURE, and that is the whole trick: the checkbox carries its own `hx-post` on `change`, and a
        // listener bound to the element runs in the target phase — after any capture listener on an
        // ancestor. Unchecking the sibling here therefore happens BEFORE htmx serialises the form, so one
        // request goes out carrying one value. In the bubble phase the request would already be built.
        this.on('change', event => this.onExclusiveSet(event), { capture: true })

        // Enter inside the search box must not submit the enclosing grid form: the form's hx-trigger
        // replaces the default submit trigger, so a native submit would bypass htmx entirely and
        // navigate the page.
        this.on('keydown', event => {
            if ((event as KeyboardEvent).key !== 'Enter') return
            if (closest(event.target, '[data-rg-set-search]')) event.preventDefault()
        })

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
            if (this.isOwn(pop)) setOpen(pop, false)
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
        if (clear && this.isOwn(clear)) { this.clearFilter(clear); return }

        const clearAll = closest<HTMLElement>(event.target, '[data-rg-scope-clearall]')
        if (clearAll && this.isOwn(clearAll)) this.clearAllFilters()
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
        setOpen(pop, true)
        // A set popup has no value input; its search box is the natural first stop instead.
        pop.querySelector<HTMLInputElement>('.rg-pop-input, [data-rg-set-search]')?.focus()
    }

    /**
     * Drops every filter this grid has, from the scope line.
     *
     * NOT the drawer's `clearAll`: that one resolves `.rg-filter-drawer` from its own trigger and clears
     * the inputs inside it, which is right for the drawer and blind to the HEADER popups — a different
     * set of elements holding the same state. This clears the region's popups, which is where the
     * filters a scope chip can name actually live.
     *
     * One request, not one per column: every cleared input would post on its own `change`, so the events
     * are suppressed while the values are reset and a single refresh is fired at the end. Page returns to
     * 1 for the same reason the drawer does it — dropping the filters changes which rows exist, so the
     * page number no longer refers to anything.
     */
    private clearAllFilters(): void {
        let touched = false
        for (const pop of this.findAll('.rg-pop')) {
            if (!this.isOwn(pop)) continue
            for (const input of pop.querySelectorAll<HTMLInputElement>('.rg-pop-input')) {
                if (input.value !== '') { input.value = ''; touched = true }
            }
            for (const box of pop.querySelectorAll<HTMLInputElement>('.rg-pop-check input:checked')) {
                box.checked = false; touched = true
            }
            for (const op of pop.querySelectorAll<HTMLSelectElement>('.rg-pop-op')) op.selectedIndex = 0
            // A set popup's search box narrows the option list; leaving it filled behind an emptied
            // filter reads as options having vanished.
            for (const search of pop.querySelectorAll<HTMLInputElement>('[data-rg-set-search]')) {
                search.value = ''
                for (const option of pop.querySelectorAll<HTMLElement>('.rg-pop-check')) option.classList.remove('rg-set-hidden')
            }
        }
        if (!touched) return

        const page = this.grid.form?.querySelector<HTMLInputElement>('input[name="page"]')
        if (page) page.value = '1'

        const htmx = (window as unknown as { htmx?: { trigger(el: Element, name: string): void } }).htmx
        if (this.grid.form) htmx?.trigger(this.grid.form, 'raptor:refresh')
    }

    /**
     * Keeps a two-valued boolean set filter to one choice.
     *
     * Only the OTHER options are cleared, never the one just clicked: unchecking the checked box still
     * clears the filter, which is the one thing a real radio group cannot do and the reason this is not
     * one. The server sees either one value or none, and never the both-ticked combination that means
     * exactly what no filter means.
     */
    private onExclusiveSet(event: Event): void {
        const box = event.target as HTMLInputElement | null
        if (!box || box.type !== 'checkbox' || !box.checked) return

        const group = closest<HTMLElement>(box, '[data-rg-set-exclusive]')
        if (!group || !this.isOwn(group)) return

        for (const other of group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
            if (other !== box) other.checked = false
        }
    }

    /**
     * Filters a set popup's options by label as the user types. Class-based hiding, not the `hidden`
     * attribute: the option rows are display:flex, which outranks the attribute's UA default.
     */
    private onSetSearch(event: Event): void {
        const input = closest<HTMLInputElement>(event.target, '[data-rg-set-search]')
        if (!input || !this.isOwn(input)) return

        const pop = input.closest<HTMLElement>('.rg-pop')
        if (!pop) return

        const query = input.value.trim().toLocaleLowerCase()
        for (const option of pop.querySelectorAll<HTMLElement>('.rg-pop-check')) {
            const matches = query === '' || (option.textContent ?? '').toLocaleLowerCase().includes(query)
            option.classList.toggle('rg-set-hidden', !matches)
        }
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

        // Clearing a set filter also clears its search: leaving a narrowed list behind an emptied
        // filter reads as options having vanished.
        const search = pop.querySelector<HTMLInputElement>('[data-rg-set-search]')
        if (search && search.value !== '') {
            search.value = ''
            for (const option of pop.querySelectorAll<HTMLElement>('.rg-pop-check')) {
                option.classList.remove('rg-set-hidden')
            }
        }

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
