import {RaptorComponent} from '../core/Component'
import {closeDialog, isTopDialog, popDialog} from '../core/dialog-stack'
import {reseatTopLayerGuests, topLayerHost} from '../core/dom'
import {FocusTrap} from '../core/focus'
import {lockScroll, unlockScroll} from '../core/scroll-lock'
import {PAGE_RESTORE_EVENT} from '../runtime/page-lifecycle'
import {openModal, takeFocusOrigin} from './open'

/**
 * The mounted `ModalComponent`s, outermost first.
 *
 * DELIBERATELY NOT THE DISMISSAL ORDER ANY MORE. Escape belongs to whatever is top-most in the TOP
 * LAYER, and this list cannot answer that: it holds only `.rg-modal`s, while `NotifyManager.confirm`
 * and `GalleryLightbox` open dialogs of their own that cover them. Gating on `topModal() !== this` was
 * measured letting one Escape dismiss an invisible confirm underneath a static modal that had just
 * refused the same key. `core/dialog-stack.ts` is the register that answers ordering now; what is left
 * here is the roster `closeAllModals()` iterates, which needs the component instances and therefore
 * cannot be the shared, element-keyed stack.
 */
const stack: ModalComponent[] = []

/** Closes every open modal. Used when a navigation replaces the page under them. */
export function closeAllModals(): void {
    for (const modal of [...stack].reverse()) modal.close()
}

// A history restore (back/forward) swaps `#app-root`, but the modal container is a body child OUTSIDE
// that region: an open dialog would survive the restore floating over the newly restored page — in the
// top layer, so above everything — and the restore chain's `resetScrollLock` would meanwhile zero the
// lock it still holds. Registered once at module scope — this chunk only loads when the first
// modal mounts, so before that there is nothing to close — and keyed to the page-lifecycle event rather
// than a direct call, so the entry bundle never has to import this chunk. Restore-only by design:
// forward navigations keep their existing behaviour.
document.addEventListener(PAGE_RESTORE_EVENT, closeAllModals)

/**
 * A modal dialog.
 *
 * Server-rendered and declarative: the page returns the dialog's markup and htmx swaps it into a
 * container, at which point the registry mounts this. There is no imperative
 * `show({ title, partialUrl, ... })` API; a dialog is defined entirely by the markup the server returns.
 *
 * THE ELEMENT IS A NATIVE `<dialog>` AND MODALITY IS THE UA'S. Nothing here writes `inert`, closes the
 * rail, or picks a z-index — `showModal()` supplies all three, and supplies them for the top layer too,
 * which the hand-written pass this replaces could not. `modal/open.ts` carries the measurements; the two
 * consequences that show up in this file are that mount() has to call it and that the element's `open`
 * attribute is live state (see modal/modalSkeleton.ts, `PRESERVED_ROOT_ATTRS`).
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

        // No-op when the skeleton already opened this element (modal/modalSkeleton.ts opens its
        // placeholder in the frame the request goes out, long before this lazily-loaded chunk arrives).
        openModal(this.el)

        // Adopt the always-on surfaces INTO this dialog. `showModal()` makes everything that is not a
        // descendant inert — measured, including elements in the top layer: a `manual` popover shown
        // over the dialog was visible and a real click on it fired nothing, while the same node
        // re-parented into the dialog took the click. The toast stack is the one surface that must
        // survive that, because error toasts stay until their close button is pressed.
        reseatTopLayerGuests(this.el)

        // The origin is claimed from whoever actually called `showModal()`; by now the UA has moved
        // focus inside the dialog, so reading `document.activeElement` here would record a control the
        // dialog owns and the close would restore focus to a node that no longer exists.
        this.trap = new FocusTrap(this.dialog)
        this.trap.activate(takeFocusOrigin(this.el))

        // Escape, the UA's way. A native modal is closed by its close watcher, which fires `cancel`
        // first — the one place a static dialog can refuse. `preventDefault()` on the non-static path
        // too, because dismissal here means REMOVING the element (see `close`), and letting the UA's own
        // close run first would leave a closed-but-present dialog for one turn of the event loop.
        this.on('cancel', event => {
            event.preventDefault()
            if (this.isStatic) return
            this.close()
        })

        // Delegated from the root rather than bound per close button: the skeleton graft replaces the
        // dialog's inner markup, including its × button, while keeping this element, so a listener bound
        // to the button itself would go stale.
        this.on('click', event => this.onClick(event as MouseEvent))

        // Escape. KEPT ALONGSIDE `cancel`, and it is this one that currently does the work — measured,
        // not assumed: a bare `<dialog>.showModal()` probe was given a trusted Escape
        // (`isTrusted: true`, `defaultPrevented: false` at the document) and stayed OPEN, firing neither
        // `cancel` nor `close`. The UA close watcher is therefore not something a dialog can rely on
        // alone. Deleting this listener in favour of `cancel` would silently remove Escape from every
        // modal in the library. The two cannot conflict: `close()` is idempotent.
        //
        // Still a document listener: focus may legitimately sit on the backdrop or have been moved by a
        // nested widget, and only the topmost dialog should react.
        //
        // `isTopDialog`, not this file's own stack: a `NotifyManager.confirm` or a `GalleryLightbox`
        // opened OVER this modal is not a `ModalComponent` and would leave `topModal() === this` true,
        // so the modal underneath used to consume the same Escape that dismissed the surface on top —
        // measured, one trusted key closing two dialogs. `stopPropagation` does not help here and never
        // did: the other listeners are on the SAME node (document), where only
        // `stopImmediatePropagation` would reach them, and ordering by registration is not the ordering
        // this needs anyway.
        this.onDocument('keydown', event => {
            const key = (event as KeyboardEvent).key
            if (key !== 'Escape' || this.isStatic || !isTopDialog(this.el)) return
            event.stopPropagation()
            this.close()
        })

        // A dialog can be closed by the server too: a swap that empties the container removes this
        // element, and teardown unwinds the lock and hands the guests back either way.
        this.onDestroy(() => this.teardown())
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
     * The graft leaves `this.el` intact — same instance, still on the stack — and normally leaves the
     * `.rg-modal-dialog` node intact too, replacing only its contents; on the fallback path, where the
     * whole subtree is reparsed, that node is gone. `this.dialog` re-queries live and resolves to
     * whichever it is, and `FocusTrap.rebind` retargets onto it (rebinding onto the same node is safe: it
     * detaches its keydown listener before re-attaching) and re-applies initial focus to the real
     * dialog's first control, without disturbing the focus it captured to restore on close.
     */
    regraft(): void {
        this.trap?.rebind(this.dialog)
    }

    /**
     * Removes the modal from the document.
     *
     * The element is removed rather than hidden so the registry's observer runs destroy() — the single
     * path that unwinds the scroll lock, the focus trap and the guest surfaces, whether the close came
     * from here, from a server swap, or from the page navigating away.
     *
     * `closeDialog` runs FIRST, and its native `close()` is not decoration: a `<dialog>` removed while
     * still open leaves `open` set on the detached node, and the same node is what the skeleton path
     * re-uses. It also hands focus back to the invoker, which is why `FocusTrap.shouldRestore()` finds
     * nothing to do on this path and does not fight the UA for the same element. It de-registers from
     * the shared stack in the same statement, SYNCHRONOUSLY — teardown pops too, but teardown is a
     * MutationObserver callback and therefore a microtask later, and a second Escape arriving inside
     * that window must already reach the dialog underneath.
     */
    close(): void {
        if (this.closing) return
        this.closing = true
        this.el.dispatchEvent(new CustomEvent('raptor:modal-close', {bubbles: true}))
        closeDialog(this.el)
        this.el.remove()
    }

    private teardown(): void {
        const index = stack.indexOf(this)
        if (index >= 0) stack.splice(index, 1)

        // Idempotent, and the path that covers a close this component never ran: a server swap that
        // empties the container removes the element without going through `close()`.
        popDialog(this.el)

        // Hand the always-on surfaces to whatever owns the top layer now — the dialog underneath, or
        // `<body>` when this was the last one. `topLayerHost()` and not this file's roster: the dialog
        // underneath may be a confirm or a lightbox, neither of which is a `ModalComponent`, and handing
        // a toast to the `.rg-modal` below one of those parks it in an inert subtree. `this.el` is
        // passed as a second search root because it is normally already DETACHED by the time destroy()
        // runs: a removed node keeps its children, so this is what stops a still-unread error toast
        // being collected along with the dialog it was adopted into.
        reseatTopLayerGuests(topLayerHost(), this.el)

        this.trap?.release()
        this.trap = null
        unlockScroll()
    }
}
