import {RaptorComponent} from '../core/Component'
import {cssEscape} from '../core/dom'
import {lockScroll, unlockScroll} from '../core/scroll-lock'

/** Conditions are named `c[{i}].{part}`; the index is what groups inputs into one condition. */
const CONDITION_NAME = /^c\[(\d+)\]\./

type FormField = HTMLInputElement | HTMLSelectElement

/**
 * The filter panel.
 *
 * It holds no filter logic — the server owns the schema, the binding and the query. What the browser
 * must own is here: opening and closing, the unit tabs, the clear affordances, and keeping the "active"
 * badge honest.
 *
 * The panel targets a *different* element (usually a grid region), so htmx never swaps the panel
 * itself. That is what keeps focus and scroll position stable while typing under live apply, and it is
 * also why the badge and the per-field dots are recomputed here instead of arriving from the server.
 */
export class FilterPanelComponent extends RaptorComponent {
    /**
     * Whether this instance is holding a page scroll lock — a ledger paired 1:1 with `lockScroll`/
     * `unlockScroll`, NOT a second copy of the open state.
     *
     * The open state is the popover's (`:popover-open`) and nothing here mirrors it. What still needs a
     * field is the lock, because teardown has to release exactly what it took: a panel destroyed while
     * open leaves the top layer without going through `close()`.
     */
    private locked = false

    private get panelId(): string {
        return this.el.dataset.rfId ?? ''
    }

    private get panel(): HTMLElement | null {
        return this.find<HTMLElement>('.rf-panel')
    }

    private get form(): HTMLFormElement | null {
        return this.find<HTMLFormElement>('.rf-form')
    }

    mount(): void {
        this.on('click', event => this.onClick(event as MouseEvent))

        // Recompute on every edit so the badge tracks what the user just typed or ticked.
        this.on('input', () => this.refreshState())
        this.on('change', () => this.refreshState())

        // The trigger button lives outside the panel (a page toolbar), so it legitimately escapes the
        // element. ESCAPE IS NOT LISTENED FOR ANY MORE: the panel is a popover, so the user agent
        // closes it — and the `toggle` handler below is what turns that into a released scroll lock.
        this.onDocument('click', event => this.onDocumentClick(event as MouseEvent))

        // `toggle` does not bubble, so it is bound to the panel itself. It fires for every path in and
        // out — the trigger, Escape, the scrim, `hidePopover()` — which is what makes it the single
        // place the lock is written.
        const panel = this.panel
        if (panel) this.bind(panel, 'toggle', event => this.onToggle(event as ToggleEvent))

        // A panel left open when its markup is replaced would leave the page scroll-locked forever.
        this.onDestroy(() => this.unlock())

        this.refreshState()
    }

    get isOpen(): boolean {
        return this.panel?.matches(':popover-open') ?? false
    }

    /**
     * `showPopover()` throws on an element that is already showing or is disconnected, which is exactly
     * the guard `if (this.opened) return` used to be — so the try/catch replaces the field rather than
     * merely wrapping it.
     */
    open(): void {
        const panel = this.panel
        if (!panel) return
        try {
            panel.showPopover()
        } catch {
            /* already showing, or the node was replaced — nothing to open */
            return
        }
        this.find<HTMLElement>('.rf-x')?.focus()
    }

    close(): void {
        try {
            this.panel?.hidePopover()
        } catch {
            /* not showing — nothing to close */
        }
    }

    /**
     * The lock, and only the lock.
     *
     * Counted in `core/scroll-lock`, so a panel opened over another locked overlay doesn't unlock the
     * page when it alone closes; guarded here, so a `toggle` that repeats a state cannot double-count.
     */
    private onToggle(event: ToggleEvent): void {
        if (event.newState === 'open') this.lock()
        else this.unlock()
    }

    private lock(): void {
        if (this.locked) return
        this.locked = true
        lockScroll()
    }

    private unlock(): void {
        if (!this.locked) return
        this.locked = false
        unlockScroll()
    }

    private onDocumentClick(event: MouseEvent): void {
        const opener = (event.target as Element | null)?.closest<HTMLElement>('[data-rf-open]')
        if (opener && opener.dataset.rfOpen === this.panelId) this.open()
    }

    private onClick(event: MouseEvent): void {
        const target = event.target as Element | null
        if (!target) return

        if (target.closest('[data-rf-close]')) {
            this.close()
            return
        }

        const tab = target.closest<HTMLButtonElement>('[data-rf-unit]')
        if (tab) {
            this.selectUnit(tab)
            return
        }

        const fieldClear = target.closest<HTMLElement>('[data-rf-clear-field]')
        if (fieldClear) {
            const section = fieldClear.closest<HTMLElement>('.rf-sec')
            if (section) this.clearFields(this.fieldsIn(section))
            return
        }

        if (target.closest('[data-rf-clear-all]')) this.clearAll()
    }

    /** Unit / currency tabs are buttons; the value they select rides on the hidden input that posts. */
    private selectUnit(tab: HTMLButtonElement): void {
        const name = tab.dataset.rfUnit
        const group = tab.parentElement
        if (!name || !group) return

        for (const other of group.querySelectorAll<HTMLElement>('[data-rf-unit]')) {
            other.setAttribute('aria-pressed', String(other === tab))
        }

        const hidden = this.find<HTMLInputElement>(`input[type="hidden"][name="${cssEscape(name)}"]`)
        if (!hidden) return
        hidden.value = tab.value
        this.apply()
    }

    private clearAll(): void {
        const search = this.find<HTMLInputElement>('input[name="search"]')
        if (search) search.value = ''
        this.clearFields(this.findAll<HTMLElement>('.rf-sec').flatMap(section => this.fieldsIn(section)))
    }

    private clearFields(fields: FormField[]): void {
        for (const field of fields) {
            if (field instanceof HTMLInputElement) {
                // The field key must survive a clear.
                if (field.type === 'hidden') continue
                if (field.type === 'checkbox') {
                    field.checked = false
                    continue
                }
                if (field.type === 'radio') {
                    // The empty-valued radio is the "any" option, so clearing means selecting it.
                    field.checked = field.value === ''
                    continue
                }
            }
            field.value = ''
        }
        this.refreshState()
        this.apply()
    }

    private fieldsIn(root: ParentNode): FormField[] {
        return [...root.querySelectorAll<FormField>('input[name], select[name]')]
    }

    /** Tells htmx something changed, which is what drives live apply. */
    private apply(): void {
        this.form?.dispatchEvent(new Event('change', {bubbles: true}))
    }

    /**
     * Recomputes the active-condition count and the per-field dots, matching how the server counts:
     * a condition is active when any of its operand inputs carries a value.
     */
    refreshState(): void {
        const form = this.form
        if (!form) return

        this.syncValuelessOperators()

        const active = new Set<string>()
        for (const field of this.fieldsIn(form)) {
            const match = CONDITION_NAME.exec(field.name)
            if (match && this.isFilled(field)) active.add(match[1])
        }

        for (const section of this.findAll<HTMLElement>('.rf-sec')) {
            const live = this.fieldsIn(section).some(field => {
                const match = CONDITION_NAME.exec(field.name)
                return match !== null && active.has(match[1])
            })

            const summary = section.querySelector('summary')
            const dot = section.querySelector('.rf-dot')
            if (live && !dot && summary) {
                const marker = document.createElement('span')
                marker.className = 'rf-dot'
                marker.setAttribute('aria-label', 'Active')
                summary.appendChild(marker)
            } else if (!live && dot) {
                dot.remove()
            }

            const clear = section.querySelector<HTMLElement>('.rf-fieldclear')
            if (clear) clear.hidden = !live
        }

        this.paintBadges(active.size)
    }

    /**
     * IsNull and IsNotNull take no operand, so the value input beside them is hidden and disabled. The
     * panel is never re-rendered after the first load — only its target region is — so this runs on every
     * edit rather than once at mount.
     */
    private syncValuelessOperators(): void {
        for (const select of this.findAll<HTMLSelectElement>('select.rf-sel')) {
            const match = CONDITION_NAME.exec(select.name)
            if (!match) continue

            const input = this.find<HTMLInputElement>(`input.rf-in[name="c[${match[1]}].v"]`)
            if (!input) continue

            const valueless = select.value === 'IsNull' || select.value === 'IsNotNull'
            input.hidden = valueless
            input.disabled = valueless
            if (valueless) input.value = ''
        }
    }

    private paintBadges(count: number): void {
        const badges = this.findAll<HTMLElement>('.rf-badge')

        // Trigger buttons live outside the panel, so they are found on the document — scoped to this
        // panel's id so two panels on one page cannot repaint each other's badge.
        if (this.panelId) {
            badges.push(
                ...document.querySelectorAll<HTMLElement>(`[data-rf-open="${cssEscape(this.panelId)}"] .rf-badge`),
            )
        }

        for (const badge of badges) {
            badge.textContent = String(count)
            badge.hidden = count === 0
        }
    }

    private isFilled(field: FormField): boolean {
        if (field instanceof HTMLInputElement) {
            // A hidden field-key carries no user intent on its own.
            if (field.type === 'hidden') return false
            if (field.type === 'checkbox') {
                // The Set field's In/Exclude toggle is an operator, not an operand: it means nothing
                // without the option checkboxes carrying it.
                if (field.name.endsWith('.op')) return false
                return field.checked
            }
            if (field.type === 'radio') return field.checked && field.value !== ''
        }
        if (field instanceof HTMLSelectElement) {
            // An operator is meaningless without its separate operand input, except IsNull and
            // IsNotNull, which are the whole condition.
            return field.value === 'IsNull' || field.value === 'IsNotNull'
        }
        return field.value.trim() !== ''
    }
}
