/**
 * Toast notifications and a modal-independent confirmation dialog.
 *
 * Neither surface is an `.rg-modal`, and BOTH ARE IN THE TOP LAYER — by two different mechanisms,
 * because they need two different things from it.
 *
 *  1. The confirm is a native `<dialog>` opened with `showModal()`. It is built imperatively and renders
 *     above an already-open modal; a stacked `rg-modal` would join the modal stack and inherit its
 *     dismissal rules, while this one answers a Promise. It used to be a `<div>` at `--rg-z-confirm`
 *     (700), and that number bought nothing: measured with the rail open, the element at the CENTRE of
 *     the confirm was `DIV#sidebar-scroll` — the dialog was behind the drawer. Worse, `.rg-ask__ok` is
 *     focused on open and is the DANGER button, so the user had a destructive confirmation focused and
 *     invisible.
 *  2. The toast stack is a `popover="manual"`. Not `auto`, measured: opening an `auto` popover CLOSES an
 *     open rail, and a success message has no business closing the menu the user opened. `manual` takes
 *     the same top layer and leaves the rail alone. Not `showModal()` either — that would trap focus,
 *     darken the page and make everything else inert, for a notification.
 *
 * THE TOAST STACK IS A TOP-LAYER GUEST (`data-rg-top-layer-guest`, core/dom.ts). A toast is not passive:
 * `show()` puts a `.rg-toast__close` button in every one and error toasts default to `duration: 0`, so
 * they stand until that button is pressed. `showModal()` makes everything that is not a descendant of
 * the dialog inert INCLUDING top-layer elements — measured, a `manual` popover over an open dialog was
 * visible and its button fired nothing — which would leave an undismissable error banner for as long as
 * any modal is open. So the container is re-parented into whatever owns the top layer, and handed back
 * when that closes.
 *
 * The markup is built with innerHTML, so it carries no CSS-isolation scope attribute and only global
 * rules can reach it. Its stylesheet is therefore part of the library's own bundle rather than a scoped
 * one.
 */

import {isTopDialog, openDialog, popDialog} from '../core/dialog-stack'
import {reseatTopLayerGuests, restackTopLayerGuest, topLayerHost} from '../core/dom'
import {lockScroll, unlockScroll} from '../core/scroll-lock'
import {PAGE_RESTORE_EVENT} from '../runtime/page-lifecycle'
import type {
    RaptorConfirmOptions,
    RaptorNotifyApi,
    RaptorNotifyOptions,
    RaptorNotifyType,
} from './types'

interface TypeStyle {
    icon: string
    accent: string
    iconColor: string
}

/** Icon-font classes. The glyphs come from the host's icon font; the library only names them. */
const TYPE_STYLES: Record<RaptorNotifyType, TypeStyle> = {
    success: {icon: 'ri-checkbox-circle-line', accent: 'rg-toast--success', iconColor: 'rg-toast__icon--success'},
    error: {icon: 'ri-close-circle-line', accent: 'rg-toast--error', iconColor: 'rg-toast__icon--error'},
    warning: {icon: 'ri-error-warning-line', accent: 'rg-toast--warning', iconColor: 'rg-toast__icon--warning'},
    info: {icon: 'ri-information-line', accent: 'rg-toast--info', iconColor: 'rg-toast__icon--info'},
}

const DEFAULT_DURATION: Record<RaptorNotifyType, number> = {
    success: 4000,
    info: 5000,
    warning: 6000,
    /** Errors stay until dismissed. */
    error: 0,
}

const CONTAINER_ID = 'app-notification-container'

export class NotifyManager implements RaptorNotifyApi {
    private container: HTMLElement | null = null

    public success(message: string, options: Partial<RaptorNotifyOptions> = {}): void {
        this.show({...options, message, type: 'success'})
    }

    public error(message: string, options: Partial<RaptorNotifyOptions> = {}): void {
        this.show({...options, message, type: 'error'})
    }

    public warning(message: string, options: Partial<RaptorNotifyOptions> = {}): void {
        this.show({...options, message, type: 'warning'})
    }

    public info(message: string, options: Partial<RaptorNotifyOptions> = {}): void {
        this.show({...options, message, type: 'info'})
    }

    public confirm(options: RaptorConfirmOptions): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            const type = options.type ?? 'warning'
            const confirmAccent = type === 'danger'
                ? 'rg-ask__btn--danger'
                : 'rg-ask__btn--primary'
            const iconStyle = type === 'danger'
                ? {icon: 'ri-error-warning-line', color: 'rg-ask__icon--danger'}
                : type === 'warning'
                    ? {icon: 'ri-error-warning-line', color: 'rg-ask__icon--warning'}
                    : {icon: 'ri-question-line', color: 'rg-ask__icon--info'}

            const overlay = document.createElement('dialog')
            overlay.className = 'rg-ask-overlay rg-ask-overlay--hidden'
            // The scrim, inline so it beats the UA `<dialog>` neutralisation in _notify.scss. Stacking is
            // the top layer's opening order now, not a z-index.
            overlay.style.backgroundColor = 'rgba(0,0,0,0.5)'

            const dialog = document.createElement('div')
            dialog.setAttribute('role', 'alertdialog')
            dialog.setAttribute('aria-modal', 'true')
            dialog.className = 'rg-ask rg-ask--collapsed'
            dialog.innerHTML = `
                <div class="rg-ask__row">
                    <i class="${iconStyle.icon} rg-ask__icon ${iconStyle.color}"></i>
                    <div class="rg-ask__body">
                        ${options.title ? `<p class="rg-ask__title">${this.escape(options.title)}</p>` : ''}
                        <p class="rg-ask__message ${options.title ? 'rg-ask__message--stacked' : ''}">${this.escape(options.message)}</p>
                    </div>
                </div>
                <div class="rg-ask__footer">
                    <button type="button" class="rg-ask__cancel rg-ask__btn rg-ask__btn--ghost">${this.escape(options.cancelText ?? 'Cancel')}</button>
                    <button type="button" class="rg-ask__ok rg-ask__btn ${confirmAccent}">${this.escape(options.confirmText ?? 'Confirm')}</button>
                </div>
            `

            overlay.appendChild(dialog)
            document.body.appendChild(overlay)
            // The top layer, and with it the inert background — the whole reason this stopped being a
            // z-index. Through `openDialog` so the confirm is REGISTERED on the shared dialog stack in
            // the same statement it is shown: that register is what tells this dialog's Escape handler
            // below whether it is the one the user is actually looking at. Guarded inside: an engine
            // without <dialog> keeps the styled overlay in the normal layer, which is where it was
            // before, and still gets its place in the Escape order.
            openDialog(overlay)
            // Adopt the toast stack, exactly as ModalComponent does: `showModal()` makes every
            // non-descendant inert, and a toast already on screen would otherwise be visible with a
            // dead close button for as long as this confirm is up.
            reseatTopLayerGuests(overlay)
            // Counted, so a confirm raised over an already-open modal doesn't unlock the page when the
            // confirm alone closes.
            lockScroll()

            requestAnimationFrame(() => {
                overlay.classList.remove('rg-ask-overlay--hidden')
                dialog.classList.remove('rg-ask--collapsed')
            })

            let settled = false
            const close = (result: boolean) => {
                if (settled) return
                settled = true
                // De-registered HERE and not in the `setTimeout` below, even though the element stays
                // connected and `open` through the whole 200ms fade: for those 200ms this dialog is on
                // its way out and must not keep answering for Escape, or a user pressing it twice in
                // quick succession loses the second press to a box that is already dismissed.
                popDialog(overlay)
                overlay.removeEventListener('cancel', onCancel)
                document.removeEventListener('keydown', onKey)
                document.removeEventListener(PAGE_RESTORE_EVENT, onRestore)
                overlay.classList.add('rg-ask-overlay--hidden')
                dialog.classList.add('rg-ask--collapsed')
                unlockScroll()
                // Left OPEN through the fade so the box does not vanish in one frame; `remove()` takes it
                // out of the top layer, which is what `close()` would otherwise have done early. The
                // guests are handed back AFTER the removal and searched for FROM the removed element —
                // `topLayerHost()` would still answer this overlay while it is connected, and a detached
                // node keeps its children, which is the only way an adopted toast survives the close.
                setTimeout(() => {
                    overlay.remove()
                    reseatTopLayerGuests(topLayerHost(), overlay)
                }, 200)
                resolve(result)
            }

            /* Escape, by BOTH routes, and the redundancy is measured rather than defensive.
               `cancel` is the UA close watcher's event and is the correct one; a trusted Escape was
               measured reaching the page (`isTrusted: true`, `defaultPrevented: false`) while a bare
               `<dialog>.showModal()` probe stayed OPEN and fired neither `cancel` nor `close`, so the
               watcher cannot be relied on alone. The keydown listener is what actually dismisses this
               dialog today; `close()` is idempotent, so an engine that fires both loses nothing.

               WHAT IS DELIBERATELY NOT HERE IS THE ENTER BINDING. The listener this replaces mapped
               Enter to `close(true)` while `.rg-ask__ok` — the DANGER button — holds focus, and while
               this surface was a z-indexed `<div>` it was measured sitting BEHIND an open rail: a
               destructive confirmation the user could not see, focused, one keystroke from firing.
               Enter needs no binding: focus is on a real `<button>`, so the UA activates whichever one
               actually has it — Cancel if the user tabbed to Cancel, which the old handler got wrong.
               `preventDefault` on `cancel` because dismissal here is `remove()` after the fade-out, not
               the UA's own close. */
            const onCancel = (ev: Event) => {
                ev.preventDefault()
                close(false)
            }
            overlay.addEventListener('cancel', onCancel)

            /* GATED ON THE SHARED STACK, and this is the defect that put that stack there. Measured,
               Chrome 390x844, real bundles, one TRUSTED Escape: with this confirm open and a
               `data-rg-modal-static` `.rg-modal` opened OVER it, `staticModalStillOpen: true` — the
               dialog on screen correctly refused the key — while `askResult: false` and this overlay
               was REMOVED. An ungated document listener answers for a dialog the user cannot see, and
               resolves a Promise its caller is still waiting on. `isTopDialog` is the only thing that
               can tell the two apart, because the surface on top need not be an `.rg-modal` at all. */
            const onKey = (ev: KeyboardEvent) => {
                if (ev.key === 'Escape' && isTopDialog(overlay)) close(false)
            }
            document.addEventListener('keydown', onKey)

            // The overlay is a body child outside `#app-root`, so a back/forward restore swapping the
            // page region leaves it floating over the restored page with its Promise unanswered and its
            // scroll lock held. Restore counts as a dismissal (resolves false) — restore only, forward
            // navigation behaviour is unchanged.
            const onRestore = () => close(false)
            document.addEventListener(PAGE_RESTORE_EVENT, onRestore)

            overlay.addEventListener('click', ev => {
                if (ev.target === overlay) close(false)
            })
            dialog.querySelector('.rg-ask__cancel')?.addEventListener('click', () => close(false))
            dialog.querySelector('.rg-ask__ok')?.addEventListener('click', () => close(true))

            ;(dialog.querySelector('.rg-ask__ok') as HTMLElement | null)?.focus()
        })
    }

    public show(options: RaptorNotifyOptions): void {
        const type = options.type ?? 'info'
        const hasItems = !!options.items && options.items.length > 0
        // A toast carrying a list is sticky by default, so there is time to read it.
        const duration = options.duration ?? (hasItems ? 0 : DEFAULT_DURATION[type])

        const container = this.ensureContainer()
        const style = TYPE_STYLES[type]

        const toast = document.createElement('div')
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status')
        toast.className = `rg-toast ${style.accent} rg-toast--hidden`

        toast.innerHTML = `
            <div class="rg-toast__row">
                <i class="${style.icon} rg-toast__icon ${style.iconColor}"></i>
                <div class="rg-toast__body">
                    ${options.title ? `<p class="rg-toast__title">${this.escape(options.title)}</p>` : ''}
                    <p class="rg-toast__message ${options.title ? 'rg-toast__message--stacked' : ''}">${this.escape(options.message)}</p>
                    ${hasItems ? this.renderItems(options.items!) : ''}
                </div>
                <button type="button" class="rg-toast__close" aria-label="Close">
                    <i class="ri-close-line rg-toast__close-icon"></i>
                </button>
            </div>
        `

        container.appendChild(toast)

        // Shows the container — a `manual` popover starts hidden — AND re-stacks it above anything that
        // entered the top layer since the previous toast. Order there is the order things were SHOWN and
        // nothing re-orders it in place, so a container shown before the rail stays under the rail until
        // it is taken down and put back up. Cheap enough to run unconditionally: it is two synchronous
        // calls on one element, with no layout flush between them.
        restackTopLayerGuest(container)

        requestAnimationFrame(() => {
            toast.classList.remove('rg-toast--hidden')
        })

        let timer: ReturnType<typeof setTimeout> | null = null
        const dismiss = () => {
            if (timer) clearTimeout(timer)
            toast.classList.add('rg-toast--hidden')
            setTimeout(() => {
                toast.remove()
                // An empty stack leaves the top layer instead of lingering there as a `display: none`
                // popover. `:empty` already keeps it from painting; this keeps it from being a stale
                // entry that the next `restackTopLayerGuest` has to take down first.
                if (container.childElementCount === 0) {
                    try {
                        container.hidePopover()
                    } catch {
                        /* not showing, or an engine without the popover API — nothing to take down */
                    }
                }
            }, 300)
        }

        toast.querySelector('.rg-toast__close')?.addEventListener('click', dismiss)

        const copyBtn = toast.querySelector('.rg-toast__copy')
        if (copyBtn && hasItems) {
            copyBtn.addEventListener('click', () => {
                void navigator.clipboard?.writeText(options.items!.join(', '))
                copyBtn.textContent = 'Copied'
                setTimeout(() => (copyBtn.textContent = 'Copy'), 1500)
            })
        }

        if (duration > 0) {
            timer = setTimeout(dismiss, duration)
            // Auto-dismiss pauses while the pointer is over the toast.
            toast.addEventListener('mouseenter', () => timer && clearTimeout(timer))
            toast.addEventListener('mouseleave', () => (timer = setTimeout(dismiss, duration)))
        }
    }

    private renderItems(items: string[]): string {
        return `
            <div class="rg-toast__items">
                <div class="rg-toast__items-bar">
                    <span class="rg-toast__items-count">${items.length} item(s)</span>
                    <button type="button" class="rg-toast__copy">Copy</button>
                </div>
                <div class="rg-toast__items-scroll">
                    <p class="rg-toast__items-text">${this.escape(items.join(', '))}</p>
                </div>
            </div>
        `
    }

    /**
     * The fixed column toasts are appended to, parented to whatever owns the top layer right now.
     *
     * Re-resolved rather than cached across navigations: a boosted swap can replace the subtree the
     * container lived in, and appending into a detached node produces a toast nobody sees.
     *
     * `popover="manual"` is what puts it in the top layer, and `manual` specifically: an `auto` popover
     * is mutually exclusive with the others, and measured, opening one CLOSED the sidebar rail. A toast
     * that shuts the menu the user just opened is not acceptable, and `manual` was measured taking the
     * same layer while leaving the rail open.
     *
     * `topLayerHost()` and not `document.body`: `showModal()` makes everything outside the dialog inert,
     * top-layer elements included — measured, a `manual` popover over an open dialog painted normally and
     * a real click on it fired nothing. As a body child this container would therefore hold an
     * undismissable error toast (`duration: 0`) for as long as any modal was open. The
     * `data-rg-top-layer-guest` marker is what gets it moved BACK when that dialog closes; without it the
     * container would be removed along with the dialog it was adopted into (ModalComponent.teardown).
     */
    private ensureContainer(): HTMLElement {
        const host = topLayerHost()

        let container = this.container
        if (!container?.isConnected) container = document.getElementById(CONTAINER_ID)

        if (!container) {
            container = document.createElement('div')
            container.id = CONTAINER_ID
            container.className = 'rg-toast-stack'
            container.setAttribute('data-rg-top-layer-guest', '')
            container.setAttribute('popover', 'manual')
        }

        if (container.parentElement !== host) host.appendChild(container)

        this.container = container
        return container
    }

    /** Escapes through the DOM rather than a replacement table, so no entity list has to be maintained. */
    private escape(value: string): string {
        const div = document.createElement('div')
        div.textContent = value
        return div.innerHTML
    }
}
