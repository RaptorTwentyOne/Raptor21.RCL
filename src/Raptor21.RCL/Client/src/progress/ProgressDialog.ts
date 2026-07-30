/**
 * A modal that reports a long-running operation while it runs, and hands back whatever it produced.
 *
 * This dialog is built imperatively, unlike the server-rendered dialogs ModalComponent normally hosts,
 * because none of its content is server markup: a percentage, a row count and a warning list are pure
 * client state, produced frame by frame by a stream the client is consuming, so there is no partial to
 * fetch.
 *
 * The element is a genuine `.rg-modal` carrying `data-rg-component="modal"`, so the registry mounts
 * ModalComponent on it and the focus trap, scroll lock, inert-below, Escape, backdrop and modal stack all
 * come from that one implementation. This file owns the body and the loop, and nothing else.
 *
 * Two conditions the code is written around:
 *
 *  1. Mounting is asynchronous. ModalComponent lives in a lazily-imported chunk, so between appending the
 *     element and the registry mounting it there is a window in which no instance exists. Every element
 *     touched here is therefore held by direct reference from the moment it is built; only `close()`
 *     consults the component, and falls back to removing the element.
 *
 *  2. The dialog can be gone. Escape, the backdrop or the × can dismiss it at any point while the stream
 *     is still running. Dismissal does not cancel the operation and the download still fires: writes into
 *     a detached node are no-ops, and the auto-close timer checks `isConnected` before acting.
 */

import {instanceOf} from '../core/registry'
import {modalContainer} from '../modal/container'
import type {ModalComponent} from '../modal/ModalComponent'
import type {
    RaptorProgressFrame,
    RaptorProgressOptions,
    RaptorProgressResult,
    RaptorProgressText,
} from './types'

const DEFAULT_TEXT: RaptorProgressText = {
    preparing: 'Preparing…',
    processing: (processed, total) =>
        total === null ? `Processing… ${processed}` : `Processing… ${processed} / ${total}`,
    completed: processed => `Completed! ${processed} rows exported.`,
    totalRows: total => `Total rows: ${total}`,
    eta: remaining => `~${remaining} remaining`,
    etaCalculating: 'estimating time remaining…',
    errorTitle: 'Error',
    completedNoFile: 'Completed (no file id/url)',
    unexpected: 'Unexpected error.',
}

const DEFAULT_AUTO_CLOSE_MS = 800

/** The nodes the loop writes into, resolved once at build time. */
interface Parts {
    root: HTMLElement
    status: HTMLElement
    track: HTMLElement
    bar: HTMLElement
    percent: HTMLElement
    info: HTMLElement
    warnings: HTMLElement
}

let titleSeq = 0

/**
 * Builds the dialog.
 *
 * Node by node rather than one innerHTML string: the title arrives from a caller, and building it as
 * markup would make every call site responsible for escaping it.
 *
 * Not static — `data-rg-modal-static` is absent — so a long-running operation can be dismissed with
 * Escape, the backdrop or the × button while it continues in the background.
 */
function build(title: string | undefined, preparing: string): Parts {
    const root = document.createElement('div')
    root.className = 'rg-modal'
    root.setAttribute('data-rg-component', 'modal')

    const dialog = document.createElement('div')
    dialog.className = 'rg-modal-dialog rg-modal-md'
    dialog.setAttribute('data-rg-modal-dialog', '')
    root.appendChild(dialog)

    const head = document.createElement('div')
    head.className = 'rg-modal-head'
    dialog.appendChild(head)

    if (title) {
        const heading = document.createElement('h2')
        heading.className = 'rg-modal-title'
        heading.id = `rg-progress-title-${++titleSeq}`
        heading.textContent = title
        head.appendChild(heading)
        root.setAttribute('aria-labelledby', heading.id)
    }

    // data-rg-autofocus: the focus trap prefers a marked element, and this is the only control in the
    // dialog.
    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.className = 'rg-modal-x'
    dismiss.setAttribute('data-rg-modal-close', '')
    dismiss.setAttribute('data-rg-autofocus', '')
    dismiss.setAttribute('aria-label', 'Close')
    dismiss.textContent = '×'
    head.appendChild(dismiss)

    const body = document.createElement('div')
    body.className = 'rg-modal-body'
    dialog.appendChild(body)

    const panel = document.createElement('div')
    panel.className = 'rg-progress'
    body.appendChild(panel)

    const status = document.createElement('div')
    status.className = 'rg-progress-status'
    // The one line a screen reader follows; polite so it does not interrupt on every batch.
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    status.textContent = preparing
    panel.appendChild(status)

    const track = document.createElement('div')
    track.className = 'rg-progress-track'
    track.setAttribute('role', 'progressbar')
    track.setAttribute('aria-valuemin', '0')
    track.setAttribute('aria-valuemax', '100')
    track.setAttribute('aria-valuenow', '0')
    panel.appendChild(track)

    const bar = document.createElement('div')
    bar.className = 'rg-progress-bar'
    bar.style.width = '0%'
    track.appendChild(bar)

    const percent = document.createElement('div')
    percent.className = 'rg-progress-meta'
    percent.textContent = '0%'
    panel.appendChild(percent)

    const info = document.createElement('div')
    info.className = 'rg-progress-meta'
    panel.appendChild(info)

    const warnings = document.createElement('div')
    warnings.className = 'rg-progress-warn'
    // The `hidden` attribute rather than a utility class: the panel's sibling-margin rule keys off it, so
    // an empty warning box adds no gap.
    warnings.hidden = true
    panel.appendChild(warnings)

    return {root, status, track, bar, percent, info, warnings}
}

/**
 * Dismisses the dialog.
 *
 * Through the component when it has mounted, so the close is announced (`raptor:modal-close`) and unwound
 * the same way every other dialog's is; by removing the element when it has not, which is what the
 * registry's observer watches for. Removing an element whose chunk is still in flight is safe, since
 * mounting checks `isConnected` before constructing.
 */
function close(root: HTMLElement): void {
    if (!root.isConnected) return
    const modal = instanceOf<ModalComponent>(root)
    if (modal) modal.close()
    else root.remove()
}

/**
 * Starts the browser's download for a URL.
 *
 * The anchor is appended inside the dialog rather than to `<body>`. While a modal is open, every body
 * child that does not contain the top of the stack carries `inert`, and an element in an inert subtree
 * cannot be clicked. The open dialog is never inert, so the anchor is reachable there.
 */
function triggerDownload(root: HTMLElement, url: string): void {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = ''
    const host = root.isConnected ? root : document.body
    host.appendChild(anchor)
    anchor.click()
    anchor.remove()
}

/**
 * Runs an operation behind the dialog, resolving when its stream ends.
 *
 * Resolution is tied to the stream rather than the dialog: it settles as soon as the last frame has been
 * consumed, while the auto-close timer is still pending, so a caller awaiting this is not held for the
 * closing animation.
 */
export async function run(options: RaptorProgressOptions): Promise<RaptorProgressResult> {
    const text: RaptorProgressText = {...DEFAULT_TEXT, ...options.text}
    const parts = build(options.title, text.preparing)
    modalContainer().appendChild(parts.root)

    const format = (value: number): string => value.toLocaleString()

    let total = 0
    let processed = 0

    // Rate samples for the estimate. A sliding window rather than a running average, so that when a job
    // slows down the countdown grows instead of stalling at the fast early rate.
    const rateWindow: { at: number; done: number }[] = []
    const startedAt = Date.now()
    let downloadUrl: string | null = null
    let hasFile = false
    let completed = false
    let error: string | null = null

    const setPercent = (value: number): void => {
        const pct = Math.max(0, Math.min(100, Math.round(value)))
        parts.bar.style.width = `${pct}%`
        parts.percent.textContent = `${pct}%`
        parts.track.setAttribute('aria-valuenow', String(pct))
    }

    const setStatus = (value: string): void => {
        parts.status.textContent = value
    }

    const setInfo = (value: string): void => {
        parts.info.textContent = value
    }

    const addWarning = (message: string): void => {
        parts.warnings.hidden = false
        const row = document.createElement('div')
        row.textContent = `⚠️ ${message}`
        parts.warnings.appendChild(row)
    }

    /**
     * Seconds left, or null while the estimate would be noise.
     *
     * Withheld for the first few seconds, because the earliest frames arrive before the throughput has
     * settled and the resulting figure swings wildly.
     */
    const etaSeconds = (): number | null => {
        if (total <= 0 || processed <= 0 || processed >= total) return null

        const now = Date.now()
        rateWindow.push({at: now, done: processed})

        // Keep ~20 seconds of history; two samples are the minimum a rate can be drawn through.
        while (rateWindow.length > 2 && now - rateWindow[0].at > 20_000) rateWindow.shift()

        if (now - startedAt < 4_000) return null

        const oldest = rateWindow[0]
        const spanMs = now - oldest.at
        const doneInSpan = processed - oldest.done
        if (spanMs < 2_000 || doneInSpan <= 0) return null

        return ((total - processed) / (doneInSpan / (spanMs / 1000)))
    }

    /** Formats a duration coarsely: "45s", "2m 15s", "1h 3m". */
    const humanize = (seconds: number): string => {
        const s = Math.max(1, Math.round(seconds))
        if (s < 60) return `${s}s`
        const m = Math.floor(s / 60)
        if (m < 60) return s % 60 === 0 ? `${m}m` : `${m}m ${s % 60}s`
        const h = Math.floor(m / 60)
        return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`
    }

    const report = (): void => {
        if (total > 0) {
            setPercent((processed / total) * 100)
            setStatus(text.processing(format(processed), format(total)))

            // The total and the estimate share one line.
            const remaining = etaSeconds()
            const eta = remaining === null ? text.etaCalculating : text.eta(humanize(remaining))
            setInfo(`${text.totalRows(format(total))} · ${eta}`)
        } else {
            setStatus(text.processing(format(processed), null))
        }
    }

    const apply = (frame: RaptorProgressFrame): void => {
        switch (frame.kind) {
            case 'total':
                // First positive figure only: the size of the job is stated once, and a later frame
                // repeating it does not rewrite the line.
                if (frame.total > 0 && total === 0) {
                    total = frame.total
                    setInfo(text.totalRows(format(total)))
                }
                return

            case 'progress':
                if (typeof frame.total === 'number' && frame.total > 0) total = frame.total

                // Absolute beats relative: a producer reporting its own running count is authoritative,
                // and mixing the two would double-count.
                if (typeof frame.processed === 'number') processed = frame.processed
                else if (typeof frame.advance === 'number' && frame.advance > 0) processed += frame.advance

                report()
                return

            case 'warning':
                // Non-fatal: the box appears and the loop carries on.
                addWarning(frame.message)
                return

            case 'error':
                // Also does not break the loop. The producer decides whether an error ends the operation,
                // and a stream reporting a per-batch failure may still emit a completion frame.
                error = frame.message
                setStatus(text.errorTitle)
                setInfo(frame.message)
                return

            case 'done': {
                completed = true
                if (typeof frame.processed === 'number') processed = frame.processed

                downloadUrl = frame.downloadUrl ?? null
                hasFile = frame.hasFile ?? downloadUrl !== null

                setPercent(100)
                setStatus(text.completed(format(processed)))

                if (downloadUrl && options.download !== false) triggerDownload(parts.root, downloadUrl)

                // Scheduled whether or not there was anything to download, and whether or not the stream
                // has more to say. 0 keeps the dialog open.
                const delay = options.autoCloseMs ?? DEFAULT_AUTO_CLOSE_MS
                if (delay > 0) window.setTimeout(() => close(parts.root), delay)
                return
            }
        }
    }

    setPercent(0)
    setStatus(text.preparing)

    try {
        for await (const frame of options.stream()) {
            apply(frame)
        }

        // The stream ended without ever naming a file. Reported even after a `done` frame, because a
        // completion that produced nothing to download is a different outcome from one that did.
        if (!hasFile) setStatus(text.completedNoFile)
    } catch (err) {
        // Reads `.message` off whatever was thrown rather than narrowing with `err instanceof Error`: a
        // fetch aborted by a signal rejects with a DOMException, which does not inherit from Error, and
        // narrowing would replace its message with the generic fallback.
        const thrown = (err as { message?: unknown } | null | undefined)?.message
        error = typeof thrown === 'string' && thrown ? thrown : text.unexpected
        setStatus(text.errorTitle)
        setInfo(error)
    }

    return {completed, processed, downloadUrl, error}
}
