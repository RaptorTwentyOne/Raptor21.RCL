import {RaptorComponent} from '../core/Component'
import {FocusTrap} from '../core/focus'
import {lockScroll, unlockScroll} from '../core/scroll-lock'

/**
 * The open modals, outermost first.
 *
 * A stack rather than a single slot, so a confirm can open over a form or a picker over a wizard step.
 * Escape and backdrop clicks apply to the top of the stack only, and everything below it is made inert so
 * neither the pointer nor the tab order can reach it.
 */
const stack: ModalComponent[] = []

export function topModal(): ModalComponent | null {
    return stack.length > 0 ? stack[stack.length - 1] : null
}

/** Closes every open modal. Used when a navigation replaces the page under them. */
export function closeAllModals(): void {
    for (const modal of [...stack].reverse()) modal.close()
}

/**
 * A modal dialog.
 *
 * Server-rendered and declarative: the page returns the dialog's markup and htmx swaps it into a
 * container, at which point the registry mounts this. There is no imperative
 * `show({ title, partialUrl, ... })` API; a dialog is defined entirely by the markup the server returns.
 *
 * The element carries its own behaviour as data attributes:
 *   data-rg-modal-static   — do not close on backdrop click or Escape (destructive confirmations)
 *   data-rg-autofocus      — on a descendant, the control to focus on open
 */
export class ModalComponent extends RaptorComponent {
    private trap: FocusTrap | null = null
    private closing = false

    private get isStatic(): boolean {
        return this.el.hasAttribute('data-rg-modal-static')
    }

    private get dialog(): HTMLElement {
        return this.find<HTMLElement>('[data-rg-modal-dialog]') ?? this.el
    }

    mount(): void {
        stack.push(this)
        lockScroll()

        this.el.setAttribute('role', 'dialog')
        this.el.setAttribute('aria-modal', 'true')

        this.trap = new FocusTrap(this.dialog)
        this.trap.activate()

        // Delegated from the root rather than bound per close button: the skeleton graft replaces the
        // dialog's inner markup, including its × button, while keeping this element, so a listener bound
        // to the button itself would go stale.
        this.on('click', event => this.onClick(event as MouseEvent))

        // Escape is a document concern: focus may legitimately sit on the backdrop or have been moved
        // by a nested widget, and only the topmost dialog should react to it.
        this.onDocument('keydown', event => {
            const key = (event as KeyboardEvent).key
            if (key !== 'Escape' || this.isStatic || topModal() !== this) return
            event.stopPropagation()
            this.close()
        })

        // A dialog can be closed by the server too: a swap that empties the container removes this
        // element, and teardown unwinds the lock and the inert layer either way.
        this.onDestroy(() => this.teardown())

        this.applyInertBelow()
    }

    private onClick(event: MouseEvent): void {
        const target = event.target
        if (!(target instanceof Element)) return

        if (target.closest('[data-rg-modal-close]')) {
            event.preventDefault()
            this.close()
            return
        }

        // Backdrop is the element itself; a click that started inside the dialog and ended outside it
        // (a drag on a text selection) must not count as a dismissal.
        if (!this.isStatic && target === this.el) this.close()
    }

    /**
     * Re-establishes the focus trap after the real dialog is grafted into this open skeleton's markup.
     *
     * The graft leaves `this.el` intact — same instance, still on the stack — but rewrites its innerHTML,
     * so the `.rg-modal-dialog` node the trap was built against in `mount()` is gone. `this.dialog`
     * re-queries live and resolves to its replacement, and `FocusTrap.rebind` retargets onto that node and
     * re-applies initial focus without disturbing the focus it captured to restore on close.
     */
    regraft(): void {
        this.trap?.rebind(this.dialog)
    }

    /**
     * Removes the modal from the document.
     *
     * The element is removed rather than hidden so the registry's observer runs destroy() — the single
     * path that unwinds the scroll lock, the focus trap and the inert layer, whether the close came
     * from here, from a server swap, or from the page navigating away.
     */
    close(): void {
        if (this.closing) return
        this.closing = true
        this.el.dispatchEvent(new CustomEvent('raptor:modal-close', {bubbles: true}))
        this.el.remove()
    }

    private teardown(): void {
        const index = stack.indexOf(this)
        if (index >= 0) stack.splice(index, 1)

        this.trap?.release()
        this.trap = null
        unlockScroll()
        this.applyInertBelow()
    }

    /**
     * Marks everything that is not the topmost dialog inert.
     *
     * `inert` is what actually removes a subtree from the accessibility tree and the tab order; a
     * z-index and a backdrop only hide it visually, leaving a screen reader free to walk the page
     * underneath. Recomputed on every open and close so a stack unwinds correctly.
     */
    private applyInertBelow(): void {
        const top = topModal()

        for (const child of document.body.children) {
            if (!(child instanceof HTMLElement)) continue
            // The container holding the modals stays reachable; the dialogs inside it are gated
            // individually below.
            if (top && child.contains(top.el)) continue
            child.toggleAttribute('inert', top !== null)
        }

        for (const modal of stack) modal.el.toggleAttribute('inert', modal !== top)
    }
}
