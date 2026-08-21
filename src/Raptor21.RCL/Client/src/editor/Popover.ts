/**
 * The small inline form the link and image commands open under their toolbar button.
 *
 * Built by the component (it exists only while a command needs input), styled by the global stylesheet, and
 * never `window.prompt`: a native prompt blocks the page, cannot be styled, and — the real reason — moves focus
 * out of the frame in a way that loses the iframe selection on some engines. This panel keeps everything inside
 * the editor root, so the component can restore the saved range before it runs the command.
 */

export interface PopoverField {
    readonly name: string
    readonly label: string
    readonly placeholder?: string
    readonly value?: string
    readonly type?: 'text' | 'url'
    readonly required?: boolean
    /** Values matching this are refused (aria-invalid + focus) — keeps script-capable URL schemes out. */
    readonly reject?: RegExp
}

export interface PopoverOptions {
    readonly title: string
    readonly fields: readonly PopoverField[]
    readonly okLabel?: string
    /** Element the panel is visually anchored under; the left edge lines up with it. */
    readonly anchor: HTMLElement
    /** Positioned-parent the panel is appended to. */
    readonly host: HTMLElement
}

export type PopoverResult = Readonly<Record<string, string>> | null

/**
 * Opens the panel and resolves with the field values on OK, `null` on Cancel / Escape / outside click.
 *
 * Returns the element as well so the owner can dismiss it imperatively (a mode switch, a destroy) — in which
 * case the promise resolves `null` like any other cancel.
 */
export function openPopover(options: PopoverOptions): {element: HTMLElement; result: Promise<PopoverResult>; close: () => void} {
    const doc = options.host.ownerDocument
    const panel = doc.createElement('div')
    panel.className = 'rg-editor__pop'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', options.title)

    const form = doc.createElement('form')
    form.className = 'rg-editor__pop-form'
    // NOT a real submit target. The panel lives INSIDE the host's form, and a nested <form> is dropped by the
    // HTML parser only when parsed — a dynamically inserted one is a real element. Its `submit` is intercepted
    // below, so Enter in a field means OK and never reaches the host's form.
    form.setAttribute('novalidate', '')
    panel.appendChild(form)

    const heading = doc.createElement('div')
    heading.className = 'rg-editor__pop-title'
    heading.textContent = options.title
    form.appendChild(heading)

    const inputs: HTMLInputElement[] = []
    for (const field of options.fields) {
        const row = doc.createElement('label')
        row.className = 'rg-editor__pop-field'
        const label = doc.createElement('span')
        label.className = 'rg-editor__pop-label'
        label.textContent = field.label
        const input = doc.createElement('input')
        input.className = 'rg-input rg-editor__pop-input'
        input.type = field.type ?? 'text'
        input.name = field.name
        input.autocomplete = 'off'
        input.spellcheck = false
        if (field.placeholder) input.placeholder = field.placeholder
        if (field.value) input.value = field.value
        if (field.required) input.required = true
        row.append(label, input)
        form.appendChild(row)
        inputs.push(input)
    }

    const actions = doc.createElement('div')
    actions.className = 'rg-editor__pop-actions'
    const cancel = doc.createElement('button')
    cancel.type = 'button'
    cancel.className = 'rg-btn rg-btn-sm rg-btn-ghost'
    cancel.textContent = 'Cancel'
    const ok = doc.createElement('button')
    // type="submit" — of the INNER form — so Enter anywhere in the panel triggers it through the platform's own
    // implicit-submission rules instead of a hand-rolled keydown.
    ok.type = 'submit'
    ok.className = 'rg-btn rg-btn-sm rg-btn-primary'
    ok.textContent = options.okLabel ?? 'OK'
    actions.append(cancel, ok)
    form.appendChild(actions)

    options.host.appendChild(panel)

    // Anchor under the button. The host is the editor root (position: relative), so the offset is the anchor's
    // position inside it; clamped so a button at the right edge does not push the panel out of the root.
    const hostRect = options.host.getBoundingClientRect()
    const anchorRect = options.anchor.getBoundingClientRect()
    const maxLeft = Math.max(0, hostRect.width - panel.offsetWidth - 8)
    panel.style.left = `${Math.min(anchorRect.left - hostRect.left, maxLeft)}px`
    panel.style.top = `${anchorRect.bottom - hostRect.top + 4}px`

    let settle: (value: PopoverResult) => void = () => {}
    const result = new Promise<PopoverResult>(resolve => (settle = resolve))

    let closed = false
    const close = (value: PopoverResult): void => {
        if (closed) return
        closed = true
        doc.removeEventListener('pointerdown', onOutside, true)
        panel.remove()
        settle(value)
    }

    const onOutside = (event: Event): void => {
        const target = event.target
        if (target instanceof Node && !panel.contains(target)) close(null)
    }
    // Capture phase, next tick: the click that OPENED the panel is still bubbling when this runs, and a
    // listener added synchronously would see it and close the panel before it is ever shown.
    setTimeout(() => {
        if (!closed) doc.addEventListener('pointerdown', onOutside, true)
    }, 0)

    form.addEventListener('submit', event => {
        event.preventDefault()
        event.stopPropagation()
        const values: Record<string, string> = {}
        for (const input of inputs) {
            const value = input.value.trim()
            const field = options.fields.find(f => f.name === input.name)
            if ((input.required && !value) || (value && field?.reject?.test(value))) {
                input.focus()
                input.setAttribute('aria-invalid', 'true')
                return
            }
            values[input.name] = value
        }
        close(values)
    })
    cancel.addEventListener('click', () => close(null))
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close(null)
        }
    })
    for (const input of inputs) input.addEventListener('input', () => input.removeAttribute('aria-invalid'))

    inputs[0]?.focus()
    inputs[0]?.select()

    return {element: panel, result, close: () => close(null)}
}
