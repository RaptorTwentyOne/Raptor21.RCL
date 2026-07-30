/**
 * Toast notifications and a modal-independent confirmation dialog.
 *
 * Neither surface is an `.rg-modal`:
 *
 *  1. The confirm is built imperatively and renders above an already-open modal. A stacked `rg-modal`
 *     would join the modal stack and inherit its dismissal rules; this one answers a Promise and is
 *     unconditionally the top-most surface (z-index 2147483600).
 *  2. Both surfaces are appended to `document.body` rather than the shared modal container. See
 *     `ensureContainer()` for how that interacts with `ModalComponent.applyInertBelow()`.
 *
 * The markup is built with innerHTML, so it carries no CSS-isolation scope attribute and only global
 * rules can reach it. Its stylesheet is therefore part of the library's own bundle rather than a scoped
 * one.
 */

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

            const overlay = document.createElement('div')
            overlay.className = 'rg-ask-overlay rg-ask-overlay--hidden'
            // Above the toast container, so a confirm is always the top-most surface.
            overlay.style.zIndex = '2147483600'
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

            requestAnimationFrame(() => {
                overlay.classList.remove('rg-ask-overlay--hidden')
                dialog.classList.remove('rg-ask--collapsed')
            })

            let settled = false
            const close = (result: boolean) => {
                if (settled) return
                settled = true
                document.removeEventListener('keydown', onKey)
                overlay.classList.add('rg-ask-overlay--hidden')
                dialog.classList.add('rg-ask--collapsed')
                setTimeout(() => overlay.remove(), 200)
                resolve(result)
            }

            const onKey = (ev: KeyboardEvent) => {
                if (ev.key === 'Escape') close(false)
                else if (ev.key === 'Enter') close(true)
            }
            document.addEventListener('keydown', onKey)

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

        requestAnimationFrame(() => {
            toast.classList.remove('rg-toast--hidden')
        })

        let timer: ReturnType<typeof setTimeout> | null = null
        const dismiss = () => {
            if (timer) clearTimeout(timer)
            toast.classList.add('rg-toast--hidden')
            setTimeout(() => toast.remove(), 300)
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
     * The fixed column toasts are appended to.
     *
     * Re-resolved rather than cached across navigations: a boosted swap can replace the subtree the
     * container lived in, and appending into a detached node produces a toast nobody sees.
     *
     * Appended to `document.body` rather than the shared modal container. `ModalComponent.applyInertBelow()`
     * walks `document.body.children` and marks every child that does not contain the topmost dialog
     * `inert`, so as a body child this container goes inert while a modal is open — but only if it already
     * existed when the modal mounted, since that pass runs on open and close.
     */
    private ensureContainer(): HTMLElement {
        if (this.container && document.body.contains(this.container)) {
            return this.container
        }

        let container = document.getElementById(CONTAINER_ID)
        if (!container) {
            container = document.createElement('div')
            container.id = CONTAINER_ID
            container.className = 'rg-toast-stack'
            // Above modals.
            container.style.zIndex = '2147483000'
            document.body.appendChild(container)
        }

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
