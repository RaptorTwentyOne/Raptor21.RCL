const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Focusable descendants in tab order, skipping anything not actually rendered. */
export function focusable(root: ParentNode): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        el => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
    )
}

/**
 * Keeps Tab inside a container and restores focus to wherever it came from on release.
 *
 * Without the trap, tabbing walks out of the dialog into the page behind it, which a screen reader then
 * reads out; without the restore, closing a dialog leaves focus on <body> and a keyboard user starts
 * again from the top of the document.
 */
export class FocusTrap {
    private previous: HTMLElement | null = null
    private root: HTMLElement
    private readonly onKeydown = (event: KeyboardEvent): void => {
        if (event.key !== 'Tab') return

        const items = focusable(this.root)
        if (items.length === 0) {
            event.preventDefault()
            this.root.focus()
            return
        }

        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement

        if (event.shiftKey && (active === first || !this.root.contains(active))) {
            event.preventDefault()
            last.focus()
        } else if (!event.shiftKey && active === last) {
            event.preventDefault()
            first.focus()
        }
    }

    constructor(root: HTMLElement) {
        this.root = root
    }

    activate(): void {
        this.previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
        this.bindTo(this.root)
    }

    /**
     * Re-targets the trap at a new root in place, without touching `previous`.
     *
     * Used when a dialog's content is replaced rather than closed — a skeleton dialog whose placeholder
     * `.rg-modal-dialog` is swapped for the server-rendered one. Tab would otherwise cycle over the
     * detached node instead of the visible content. Calling `activate()` again would not do: it
     * recaptures `document.activeElement`, by then something inside the dialog itself, as the element
     * to restore focus to on close.
     */
    rebind(root: HTMLElement): void {
        this.root.removeEventListener('keydown', this.onKeydown)
        this.root = root
        this.bindTo(root)
    }

    private bindTo(root: HTMLElement): void {
        if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
        const initial = root.querySelector<HTMLElement>('[data-rg-autofocus]') ?? focusable(root)[0] ?? root
        initial.focus()

        root.addEventListener('keydown', this.onKeydown)
    }

    release(): void {
        this.root.removeEventListener('keydown', this.onKeydown)
        if (this.previous?.isConnected && this.root.contains(document.activeElement)) this.previous.focus()
        this.previous = null
    }
}
