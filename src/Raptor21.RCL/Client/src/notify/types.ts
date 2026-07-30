/**
 * The toast / confirm vocabulary.
 *
 * A toast is a title, a message, an optional list and a severity. The severity names are the library's
 * own and pick both the accent and the default dwell time; a caller never passes a colour.
 */

export type RaptorNotifyType = 'success' | 'error' | 'warning' | 'info'

export interface RaptorNotifyOptions {
    /** Optional bold heading shown above the message. */
    title?: string

    /** Main message body. */
    message: string

    /**
     * Rendered as a scrollable, copyable block under the message — the ids an import skipped, say.
     *
     * Its presence also changes the default dwell time to "until dismissed", so the list stays on screen
     * long enough to read.
     */
    items?: string[]

    type?: RaptorNotifyType

    /** Auto-dismiss delay in ms. 0 keeps the toast until the user closes it. */
    duration?: number
}

export interface RaptorConfirmOptions {
    /** Optional bold heading. */
    title?: string

    /** Question body. */
    message: string

    /** Confirm button label (default "Confirm"). */
    confirmText?: string

    /** Cancel button label (default "Cancel"). */
    cancelText?: string

    /** Visual emphasis of the confirm button. */
    type?: 'default' | 'warning' | 'danger'
}

export interface RaptorNotifyApi {
    success(message: string, options?: Partial<RaptorNotifyOptions>): void

    error(message: string, options?: Partial<RaptorNotifyOptions>): void

    warning(message: string, options?: Partial<RaptorNotifyOptions>): void

    info(message: string, options?: Partial<RaptorNotifyOptions>): void

    show(options: RaptorNotifyOptions): void

    /**
     * A confirmation that resolves true (confirm) or false (cancel, backdrop or Escape).
     *
     * Not the same dialog `hx-confirm` opens, which builds a real `.rg-modal`. This one is built
     * imperatively from a Promise and renders over an already-open modal, which a stacked `.rg-modal`
     * cannot do without joining the modal stack and inheriting its dismissal rules.
     */
    confirm(options: RaptorConfirmOptions): Promise<boolean>
}
