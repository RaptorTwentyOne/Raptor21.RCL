import { RaptorComponent } from '../core/Component'
import { positionAt, trackAnchor } from '../core/anchor'
import { TOP_LAYER_CLAIM_EVENT } from '../core/dialog-stack'
import { markPortalled, portalTarget } from '../core/dom'

interface Choice {
    value: string
    label: string
    disabled: boolean
    group: string | null
}

/** Panels currently owned by a live instance. Anything else in `<body>` bearing the panel class is an
 * orphan left behind by an instance whose teardown never ran, and is safe to sweep on the next mount. */
const livePanels = new Set<HTMLElement>()

/**
 * An accessible combobox that enhances a real `<select>`.
 *
 * Enhancement rather than replacement: the native element stays in the DOM and remains the source of
 * truth, so the form posts exactly what it otherwise would, server-side model binding and validation are
 * untouched, and the control still works if this script never runs.
 *
 * Markup:
 *   <div data-rg-component="select"><select ...>...</select></div>
 *
 * Attributes on the wrapper:
 *   data-rg-search="auto|always|never"  show the filter box (auto: only past a threshold)
 *   data-rg-placeholder="…"             text shown when nothing is selected
 *   data-rg-clearable                   offer a clear affordance for a single select
 */
export class SelectComponent extends RaptorComponent {
    private select!: HTMLSelectElement
    private button!: HTMLButtonElement
    private panel!: HTMLElement
    private list!: HTMLElement
    private search: HTMLInputElement | null = null

    private choices: Choice[] = []
    private filtered: Choice[] = []
    private activeIndex = -1
    private open = false
    private untrack: (() => void) | null = null

    /** Typed characters accumulate briefly so "ne" jumps to Netherlands, not to E. */
    private typeahead = ''
    private typeaheadTimer = 0

    private get multiple(): boolean {
        return this.select.multiple
    }

    private get placeholder(): string {
        return this.el.dataset.rgPlaceholder ?? 'Select…'
    }

    mount(): void {
        // A history restore resurrects markup that was enhanced when the snapshot was taken: the
        // serialised .rg-select-button comes back inside the wrapper, the registry re-mounts the fresh
        // element, and without this cleanup the new instance would build a second button next to the
        // stale one. Same story when a wrapper is detached and re-attached — destroy() removes the
        // panel but the button stays in the subtree. Orphaned body-level panels (an instance whose
        // teardown never ran) are swept alongside, as defence in depth.
        //
        // The sweep is still scoped to `<body>`'s own children, and it is now an INCOMPLETE net: since
        // `portalTarget`, an open panel can be parented into an open popover instead, and an instance
        // whose teardown never ran could strand one there. Left deliberately: `destroy()` removes the
        // panel from wherever it is parented, so this only ever mattered for teardowns that did not
        // happen at all, and the alternative — a document-wide `querySelectorAll` on every select mount,
        // on every page — costs more than the failure it would catch. A stranded panel is `hidden`.
        for (const remnant of this.el.querySelectorAll(':scope > .rg-select-button')) remnant.remove()
        for (const panel of document.body.querySelectorAll<HTMLElement>(':scope > .rg-select-panel')) {
            if (!livePanels.has(panel)) panel.remove()
        }

        const select = this.find<HTMLSelectElement>('select')
        if (!select) {
            console.warn('[raptor21] data-rg-component="select" needs a <select> inside it')
            return
        }
        this.select = select
        this.readChoices()

        // The native control keeps working for assistive tech that drives it directly, and for a
        // no-JS submit; it is only removed from the *visual* layer and the tab order.
        select.classList.add('rg-sr-only')
        select.tabIndex = -1
        select.setAttribute('aria-hidden', 'true')

        this.buildUi()
        this.renderValue()

        // The server can replace the options (a dependent select reloading via htmx) without this
        // component being re-mounted, so re-read rather than trusting the snapshot taken at mount.
        this.bind(this.el, 'htmx:afterSettle', () => {
            this.readChoices()
            this.renderValue()
            if (this.open) this.renderOptions()
        })

        // Something else may set the value programmatically — a reset, a linked field.
        this.bind(this.select, 'change', () => {
            this.renderValue()
            if (this.open) this.renderOptions()
        })

        this.onDestroy(() => this.closePanel())
    }

    // --- construction ------------------------------------------------------

    private readChoices(): void {
        this.choices = [...this.select.options].map(option => ({
            value: option.value,
            label: option.text,
            disabled: option.disabled,
            group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : null,
        }))
    }

    private buildUi(): void {
        this.button = document.createElement('button')
        this.button.type = 'button'
        this.button.className = 'rg-select-button'
        this.button.setAttribute('role', 'combobox')
        this.button.setAttribute('aria-expanded', 'false')
        this.button.setAttribute('aria-haspopup', 'listbox')
        if (this.select.disabled) this.button.disabled = true
        // Reuse the label the author already wrote for the native control.
        const labelled = this.select.labels?.[0]
        if (labelled) this.button.setAttribute('aria-labelledby', (labelled.id ||= `rg-sel-l-${this.select.id || Math.abs(hash(this.select.name))}`))

        this.panel = document.createElement('div')
        this.panel.className = 'rg-select-panel'
        this.panel.hidden = true
        // See core/dom.ts `PORTAL_MARK`: this node's parent is decided by `portalTarget`, so a host with
        // layout rules for its own children (the page shell's overflow menu, measured) must be able to
        // tell it apart from the controls the author really put in that box.
        markPortalled(this.panel)

        this.list = document.createElement('div')
        this.list.className = 'rg-select-list'
        this.list.setAttribute('role', 'listbox')
        if (this.multiple) this.list.setAttribute('aria-multiselectable', 'true')

        if (this.wantsSearch()) {
            this.search = document.createElement('input')
            this.search.type = 'text'
            this.search.className = 'rg-select-search'
            this.search.placeholder = 'Search…'
            this.search.setAttribute('aria-label', 'Search options')
            this.search.autocomplete = 'off'
            this.panel.appendChild(this.search)
            this.bind(this.search, 'input', () => this.renderOptions())
            this.bind(this.search, 'keydown', event => this.onKeydown(event as KeyboardEvent))
        }

        this.panel.appendChild(this.list)
        this.el.appendChild(this.button)
        // The panel is portalled out of the wrapper: inside it, it would be clipped by any scrolling
        // ancestor — a grid cell, a modal body — which is the usual reason a dropdown appears cut off.
        // `portalTarget` and not a bare `<body>`: when an ancestor is showing as a popover, <body> is
        // BELOW the top layer and the panel would be painted under it (see core/dom.ts for the
        // measurements). `openPanel` recomputes it, because whether that ancestor is open changes
        // between opens while this runs exactly once.
        portalTarget(this.el).appendChild(this.panel)
        livePanels.add(this.panel)
        this.onDestroy(() => {
            livePanels.delete(this.panel)
            this.panel.remove()
        })

        this.bind(this.button, 'click', () => this.toggle())
        this.bind(this.button, 'keydown', event => this.onKeydown(event as KeyboardEvent))
        this.bind(this.list, 'click', event => this.onListClick(event as MouseEvent))
        this.onDocument('pointerdown', event => {
            if (!this.open) return
            const target = event.target
            if (target instanceof Node && !this.panel.contains(target) && !this.el.contains(target)) this.closePanel()
        })

        // An ancestor popover closing takes the panel off screen with it (the closed subtree is
        // `display: none`), so this component must not be left believing it is still open: the stale
        // `open` flag would swallow the next click on the button as a close, and `trackAnchor` would go
        // on repositioning a panel nobody can see. capture: true because `toggle` does not bubble;
        // `[popover]`-only because `<details>` fires the same event shape and is not an owner here.
        this.onDocument('toggle', event => {
            if (!this.open) return
            if ((event as ToggleEvent).newState !== 'closed') return
            const host = event.target
            if (!(host instanceof HTMLElement) || !host.hasAttribute('popover')) return
            if (!host.contains(this.el)) return
            this.closePanel()
        }, {capture: true})

        // …and when a `<dialog>` takes the top layer, which the listener above structurally cannot see:
        // a modal dialog fires no `toggle`, and it is not an ancestor of this panel — `showModal()` acts
        // on everything it does NOT contain. The panel is then painted but inert (measured on the
        // dropdown, same mechanism, same result: `checkVisibility(): true` while `elementsFromPoint` at
        // its centre returns the dialog), and `trackAnchor` would go on repositioning a control nobody
        // can reach. A claim from a host that contains this wrapper is a dialog that OWNS the select —
        // a form in a modal — and must not close it.
        this.onDocument(TOP_LAYER_CLAIM_EVENT, event => {
            if (!this.open) return
            const host = (event as CustomEvent<{ host: HTMLElement }>).detail?.host
            if (host?.contains(this.el)) return
            this.closePanel()
        })
    }

    private wantsSearch(): boolean {
        const mode = this.el.dataset.rgSearch ?? 'auto'
        if (mode === 'always') return true
        if (mode === 'never') return false
        // Below a handful of options a filter box is more chrome than help.
        return this.choices.length >= 8
    }

    // --- rendering ---------------------------------------------------------

    private selectedValues(): string[] {
        return [...this.select.selectedOptions].map(o => o.value).filter(v => v !== '')
    }

    private renderValue(): void {
        const selected = this.selectedValues()
        const labels = this.choices.filter(c => selected.includes(c.value)).map(c => c.label)

        this.button.textContent = labels.length > 0 ? labels.join(', ') : this.placeholder
        this.button.classList.toggle('rg-select-empty', labels.length === 0)
        this.button.disabled = this.select.disabled
    }

    private renderOptions(): void {
        const term = this.search?.value.trim().toLowerCase() ?? ''
        this.filtered = term
            ? this.choices.filter(c => c.label.toLowerCase().includes(term))
            : this.choices.slice()

        const selected = this.selectedValues()
        this.list.textContent = ''

        if (this.filtered.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'rg-select-empty-msg'
            empty.textContent = 'No matches'
            this.list.appendChild(empty)
            this.activeIndex = -1
            this.button.removeAttribute('aria-activedescendant')
            return
        }

        let lastGroup: string | null = null
        this.filtered.forEach((choice, index) => {
            if (choice.group && choice.group !== lastGroup) {
                const heading = document.createElement('div')
                heading.className = 'rg-select-group'
                heading.textContent = choice.group
                this.list.appendChild(heading)
            }
            lastGroup = choice.group

            const option = document.createElement('div')
            option.className = 'rg-select-option'
            option.id = `${this.optionIdPrefix()}-${index}`
            option.setAttribute('role', 'option')
            option.setAttribute('aria-selected', String(selected.includes(choice.value)))
            if (choice.disabled) option.setAttribute('aria-disabled', 'true')
            option.dataset.value = choice.value
            option.textContent = choice.label
            this.list.appendChild(option)
        })

        // Keep the highlight on something real after a filter narrows the list.
        if (this.activeIndex >= this.filtered.length) this.activeIndex = this.filtered.length - 1
        if (this.activeIndex < 0) {
            const firstSelected = this.filtered.findIndex(c => selected.includes(c.value))
            this.activeIndex = firstSelected >= 0 ? firstSelected : 0
        }
        this.paintActive()
    }

    private optionIdPrefix(): string {
        return `rg-opt-${this.select.name || this.select.id || 'select'}`
    }

    private paintActive(): void {
        const options = [...this.list.querySelectorAll<HTMLElement>('.rg-select-option')]
        options.forEach((option, index) => option.classList.toggle('rg-active', index === this.activeIndex))

        const active = options[this.activeIndex]
        if (active) {
            // aria-activedescendant, not focus: focus stays on the search box so typing continues.
            this.button.setAttribute('aria-activedescendant', active.id)
            this.search?.setAttribute('aria-activedescendant', active.id)
            active.scrollIntoView({ block: 'nearest' })
        }
    }

    // --- interaction -------------------------------------------------------

    private toggle(): void {
        if (this.open) this.closePanel()
        else this.openPanel()
    }

    private openPanel(): void {
        if (this.open || this.select.disabled) return

        // Re-home the panel for THIS open. The answer moves: a select inside the page shell's "…" menu
        // or the sidebar's foot belongs in that popover's subtree while it is showing, and back under
        // <body> once it is not. Cheap and idempotent — an unchanged parent is a single reference test.
        const target = portalTarget(this.el)
        if (this.panel.parentElement !== target) target.appendChild(this.panel)

        this.open = true
        this.panel.hidden = false
        this.button.setAttribute('aria-expanded', 'true')

        this.activeIndex = -1
        if (this.search) this.search.value = ''
        this.renderOptions()

        positionAt(this.panel, this.button, { matchWidth: true })
        this.untrack = trackAnchor(this.panel, this.button, { matchWidth: true })

        this.search?.focus()
    }

    private closePanel(): void {
        if (!this.open) return
        this.open = false
        this.panel.hidden = true
        this.button.setAttribute('aria-expanded', 'false')
        this.button.removeAttribute('aria-activedescendant')
        this.untrack?.()
        this.untrack = null
    }

    private onListClick(event: MouseEvent): void {
        const option = (event.target as Element | null)?.closest<HTMLElement>('.rg-select-option')
        if (!option || option.getAttribute('aria-disabled') === 'true') return
        this.commit(option.dataset.value ?? '')
    }

    private commit(value: string): void {
        if (this.multiple) {
            for (const option of this.select.options) {
                if (option.value === value) option.selected = !option.selected
            }
        } else {
            this.select.value = value
        }

        // A real change event on the native element: anything already listening — htmx bindings, the
        // page's own scripts, validation — keeps working without knowing this component exists.
        this.select.dispatchEvent(new Event('input', { bubbles: true }))
        this.select.dispatchEvent(new Event('change', { bubbles: true }))

        this.renderValue()
        if (this.multiple) this.renderOptions()
        else {
            this.closePanel()
            this.button.focus()
        }
    }

    private onKeydown(event: KeyboardEvent): void {
        const { key } = event

        if (!this.open) {
            if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
                event.preventDefault()
                this.openPanel()
            }
            return
        }

        switch (key) {
            case 'Escape':
                event.preventDefault()
                // Escape belongs to the innermost open layer: without this it keeps bubbling to the
                // modal's document listener, and dismissing this panel would also close the dialog.
                event.stopPropagation()
                this.closePanel()
                this.button.focus()
                return
            case 'ArrowDown':
                event.preventDefault()
                this.move(1)
                return
            case 'ArrowUp':
                event.preventDefault()
                this.move(-1)
                return
            case 'Home':
                event.preventDefault()
                this.activeIndex = 0
                this.paintActive()
                return
            case 'End':
                event.preventDefault()
                this.activeIndex = this.filtered.length - 1
                this.paintActive()
                return
            case 'Enter': {
                event.preventDefault()
                const choice = this.filtered[this.activeIndex]
                if (choice && !choice.disabled) this.commit(choice.value)
                return
            }
            case 'Tab':
                // Tabbing away commits nothing and closes, matching a native select.
                this.closePanel()
                return
        }

        // Type-ahead only matters when there is no search box to type into.
        if (!this.search && key.length === 1) this.typeAhead(key)
    }

    private move(delta: number): void {
        if (this.filtered.length === 0) return
        let next = this.activeIndex
        // Step over disabled entries rather than letting the highlight rest on one.
        for (let i = 0; i < this.filtered.length; i++) {
            next = (next + delta + this.filtered.length) % this.filtered.length
            if (!this.filtered[next].disabled) break
        }
        this.activeIndex = next
        this.paintActive()
    }

    private typeAhead(char: string): void {
        window.clearTimeout(this.typeaheadTimer)
        this.typeahead += char.toLowerCase()
        this.typeaheadTimer = window.setTimeout(() => (this.typeahead = ''), 500)

        const found = this.filtered.findIndex(c => c.label.toLowerCase().startsWith(this.typeahead))
        if (found >= 0) {
            this.activeIndex = found
            this.paintActive()
        }
    }
}

function hash(value: string): number {
    let h = 0
    for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0
    return h
}
