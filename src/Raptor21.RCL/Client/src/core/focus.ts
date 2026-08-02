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

    /**
     * Starts trapping, and records what to hand focus back to on release.
     *
     * `origin` exists for one caller: a native `<dialog>` is already showing — and has already moved
     * focus inside itself — by the time `ModalComponent` mounts on it, because `showModal()` is called
     * the moment the element lands in the document while the component's chunk is still loading.
     * Reading `document.activeElement` here would then record a control the dialog itself owns, which is
     * removed with it, so the restore silently becomes a no-op and a keyboard user is returned to the
     * top of the document. Whoever opened the dialog captured the outgoing element instead
     * (modal/open.ts) and passes it in.
     *
     * Omitted or `null`, the reading is taken here, which is right for every trap that begins in the
     * same turn as the interaction that created it (the mobile drawer, runtime/sidebar.ts).
     */
    activate(origin?: HTMLElement | null): void {
        this.previous =
            origin ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
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
        if (this.previous?.isConnected && this.shouldRestore()) this.previous.focus()
        this.previous = null
    }

    /**
     * Whether closing this trap should hand focus back to where it came from.
     *
     * "Focus is still inside the trap" is the obvious test and it is the one that matters when the
     * dialog is dismissed while it is still on screen. It is not sufficient, because the library closes
     * a modal by REMOVING its element (`ModalComponent.close`) — that is what runs destroy() and lands
     * here. Removing the node that holds focus drops focus to <body> before this method is reached, so
     * the containment test can never pass on the ordinary close path and focus would be left on <body>:
     * a keyboard or screen-reader user who opened a dialog from a menu is returned to the top of the
     * document instead of to the control they opened it with.
     *
     * The second clause is deliberately narrow. It fires only when the trap's root is already detached
     * AND focus went NOWHERE — body or nothing. If anything else has deliberately taken focus in the
     * meantime (a control the dialog's own action focused, a following dialog in the stack), that
     * element is the more recent intent and must be left alone.
     */
    private shouldRestore(): boolean {
        const active = document.activeElement
        if (this.root.contains(active)) return true
        return !this.root.isConnected && (active === null || active === document.body)
    }
}
