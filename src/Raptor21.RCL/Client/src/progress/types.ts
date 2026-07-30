/**
 * The progress dialog's vocabulary.
 *
 * Expressed in the library's own words rather than any caller's wire format: a caller maps its stream
 * onto these frames, and the library never learns a consuming application's DTO. The same vocabulary
 * therefore serves any long-running operation — an export, a bulk import, a re-index.
 */

/** One step reported by a running operation. */
export type RaptorProgressFrame =
/**
 * How much work there is in total.
 *
 * Honoured once: the first positive total is what the dialog reports, and later ones do not rewrite
 * that line. A stream that refines its estimate as it goes should carry the new figure on the
 * `progress` frame's own `total`, which does update the bar.
 */
    | { kind: 'total'; total: number }
    /**
     * Work done. Either absolute (`processed`) or relative (`advance`); absolute wins when both are
     * present. `total` refreshes the denominator without touching the "total rows" line.
     */
    | { kind: 'progress'; processed?: number; advance?: number; total?: number }
    /** A non-fatal problem. Accumulates in a warning box; the operation keeps running. */
    | { kind: 'warning'; message: string }
    /**
     * A fatal-looking problem the producer nonetheless kept streaming through. The dialog shows it and
     * keeps consuming — closing the stream is the producer's decision, not the dialog's.
     */
    | { kind: 'error'; message: string }
    /** The operation finished, optionally with a file to hand back. */
    | {
    kind: 'done'
    processed?: number
    downloadUrl?: string | null
    /**
     * Whether the operation produced a file at all, when that is not the same question as "did I get a
     * URL". A producer that identified a file but could not build a URL for it (no base URL configured,
     * say) sets this true so the dialog does not end on its "finished, but nothing to download" line.
     * Defaults to `downloadUrl !== null`.
     */
    hasFile?: boolean
}

/** Every string the dialog can render. Supplied whole by the library, overridable field by field. */
export interface RaptorProgressText {
    /** Shown from the moment the dialog opens until the first frame arrives. */
    preparing: string

    /** `total` is null while the size of the job is still unknown. Both numbers arrive pre-formatted. */
    processing: (processed: string, total: string | null) => string

    completed: (processed: string) => string

    totalRows: (total: string) => string

    /**
     * Time left, once there is enough signal to estimate it. `remaining` arrives pre-humanised ("2m 15s").
     * Rendered next to the total rather than in place of it.
     */
    eta: (remaining: string) => string

    /** Shown in the ETA's place while the rate is still too noisy to project from. */
    etaCalculating: string

    /** Status line for a reported error. */
    errorTitle: string

    /** Status line when the stream ended without ever producing a file. */
    completedNoFile: string

    /** Fallback message when the stream threw something without a usable `message`. */
    unexpected: string
}

export interface RaptorProgressOptions {
    /** Dialog heading. */
    title?: string

    /**
     * Opens the operation and yields its frames.
     *
     * A factory rather than an iterable, so nothing starts until the dialog is on screen and the request
     * made on the first `next()` is not already in flight beforehand.
     */
    stream: () => AsyncIterable<RaptorProgressFrame>

    text?: Partial<RaptorProgressText>

    /** Delay before the dialog closes itself once the operation completes. 0 keeps it open. Default 800. */
    autoCloseMs?: number

    /** Trigger the `done` frame's downloadUrl. Default true. */
    download?: boolean
}

export interface RaptorProgressResult {
    /** A `done` frame arrived. */
    completed: boolean

    /** The final count the dialog displayed. */
    processed: number

    downloadUrl: string | null

    /** The last error reported, whether by an `error` frame or by the stream throwing. */
    error: string | null
}
