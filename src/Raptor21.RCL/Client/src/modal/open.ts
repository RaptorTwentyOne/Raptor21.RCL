/**
 * Putting a modal in the TOP LAYER, and remembering where focus came from while doing it.
 *
 * WHY `<dialog>.showModal()` AND NOT A z-index.
 * Every `.rg-modal` used to be a `<div>` at `--rg-z-modal` (400) in the normal layer, and the rail is a
 * `popover`, i.e. in the TOP layer. There is no z-index between the two: measured in Chrome at 390x844,
 * with the rail open, a `<body>` child probe at z-index 300 / 400 / 500 / 600 / 700 AND 2147483647 was
 * returned UNDER the rail by `elementsFromPoint` in all six cases. What that produced on screen was
 * measured too — an open rail plus an open dialog left the dialog sliced in half at the rail's edge
 * (x=240), and the whole rail rect went DEAD: a real tap on the rail's own visible foot button fired
 * nothing but the drawer's close, and a real tap on the dialog's Cancel where the rail painted over it
 * fired nothing at all. Visible and dead, in both directions.
 *
 * `showModal()` answers all of it from the UA:
 *   · the dialog joins the top layer, so it is above the rail regardless of z-index;
 *   · the UA CLOSES every open `auto` popover as it opens (measured: rail open before, `beforetoggle
 *     open→closed` and `railOpen: false` after), so the sliced-dialog state cannot be constructed;
 *   · everything that is not a descendant of the dialog goes inert — INCLUDING other top-layer
 *     elements (measured: a `manual` popover shown AFTER `showModal()` is visible but a real click on
 *     it fires no listener), which is more than `ModalComponent`'s hand-written `inert` pass ever did;
 *   · nesting is free: a second `showModal()` covers the first.
 *
 * WHY THE ORIGIN IS TRACKED HERE.
 * `FocusTrap.activate()` reads `document.activeElement` to know what to focus on close, and
 * `showModal()` has already moved focus INTO the dialog by the time the component mounts — the modal
 * chunk is lazy, and the skeleton (modal/modalSkeleton.ts) deliberately opens the placeholder in the
 * same frame the request goes out rather than waiting for it. So whoever calls `showModal` records the
 * outgoing `activeElement` and `ModalComponent` claims it.
 */

import {openDialog, pushDialog} from '../core/dialog-stack'

/** The element focus sat on when each dialog was opened. Weak, so a dismissed dialog is collectable. */
const ORIGIN = new WeakMap<Element, HTMLElement | null>()

/** `typeof`, not a bare reference: the identifier does not exist at all on an engine without <dialog>,
 *  and `x instanceof Undeclared` throws a ReferenceError rather than answering false. */
const HAS_DIALOG = typeof HTMLDialogElement !== 'undefined'

/**
 * Shows `el` as a modal, if it is a `<dialog>` that is not already showing, and registers it on the
 * shared dialog stack (core/dialog-stack.ts) either way.
 *
 * Idempotent on purpose: the skeleton opens its placeholder immediately and `ModalComponent.mount()`
 * calls this again for the server-rendered case, where nothing has opened it yet.
 *
 * REGISTRATION IS NOT SKIPPED FOR AN ALREADY-OPEN DIALOG, and the focus origin IS: this is the second
 * call for a dialog the skeleton opened (which recorded the origin then, from the frame focus actually
 * left) and the FIRST call for one the server rendered carrying `open`. Only the latter needs the push,
 * and neither wants the origin overwritten with a control the dialog itself already owns.
 * `pushDialog` does not re-order an element it already holds, so the double call is free.
 *
 * A `.rg-modal` THAT IS NOT A `<dialog>` IS REGISTERED ANYWAY, and skipping that was a measured defect
 * rather than a tidy detail. `core/dialog-stack.ts` promises exactly this — "registered but not shown …
 * still gets correct Escape ordering, which is the half that does not need the API" — and this function
 * is the only caller that ever reaches it for a `.rg-modal`, so an early `return` here retracted the
 * promise for every one of them. Two things produce such an element: an engine without `<dialog>`, and a
 * consumer that authored the markup itself (nothing in this package does — `RaptorModal.razor`, the sole
 * modal emitter, renders a `<dialog>` — but `.rg-modal` is a public class and the stylesheet
 * renders it: the closed-state rule is `dialog.rg-modal:not([open])`, element-qualified precisely so the
 * fallback still paints). MEASURED before this line, Chrome 150, real bundles, 390x844, a
 * `<div class="rg-modal" data-rg-component="modal">` grafted into `#modal-container`: it mounted
 * (`role="dialog"`, `aria-modal="true"`), took the scroll lock (`body.style.overflow: "hidden"`) and
 * covered the viewport with its `::before` scrim — and Escape did NOT dismiss it, because
 * `isTopDialog(this.el)` in ModalComponent can only ever be false for an element that was never pushed.
 * A full-screen overlay the keyboard cannot dismiss.
 *
 * `pushDialog` AND NOT `openDialog` on that branch, deliberately. `openDialog` announces
 * `TOP_LAYER_CLAIM_EVENT`, whose whole meaning is "a dialog just entered the top layer and made every
 * non-descendant inert" — the signal `DropdownComponent`/`SelectComponent` close on. Nothing entered the
 * top layer here and nothing went inert: a panel at `--rg-z-popover` (500) still paints over a
 * normal-layer overlay and still takes clicks, so closing it would be a regression, not a fix. The
 * Escape order is the half that applies; the claim is the half that does not.
 */
export function openModal(el: HTMLElement): void {
    if (!el.isConnected) return

    if (!HAS_DIALOG || !(el instanceof HTMLDialogElement)) {
        pushDialog(el)
        return
    }

    if (!el.open) ORIGIN.set(el, document.activeElement instanceof HTMLElement ? document.activeElement : null)
    openDialog(el)
}

/**
 * The element focus came from when `el` was opened, consumed once.
 *
 * Answers `null` when nothing recorded one, which is the signal for `FocusTrap.activate()` to fall back
 * to reading `document.activeElement` itself — correct for a dialog that never went through
 * `showModal()`.
 */
export function takeFocusOrigin(el: Element): HTMLElement | null {
    const origin = ORIGIN.get(el) ?? null
    ORIGIN.delete(el)
    return origin
}
