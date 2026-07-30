import { GridFeature } from '../GridFeature'

/** The fields this feature reads off an htmx response event. */
interface HtmxResponseDetail {
    readonly target?: EventTarget | null
    readonly xhr?: XMLHttpRequest
}

function detailOf(event: Event): HtmxResponseDetail | undefined {
    return (event as CustomEvent<HtmxResponseDetail | undefined>).detail ?? undefined
}

/** The element htmx is about to swap into, when there is one. */
function swapTargetOf(event: Event): Element | null {
    const target = detailOf(event)?.target
    return target instanceof Element ? target : null
}

/**
 * Surfaces a failed load.
 *
 * htmx does not swap on a non-2xx response, so a 500 leaves the previous rows on screen and the grid
 * goes on showing stale data as though it answered the filter the user just set. A bar above the rows
 * states what went wrong and that the rows below it are from the previous query.
 */
export class LoadErrors extends GridFeature {
    init(): void {
        // htmx fires responseError on the element that made the request rather than the one being
        // swapped, and that element need not be inside this region — a refresh button may sit anywhere
        // on the page and point at this grid. The document is therefore the only place the event
        // reliably reaches; which grid the failure belongs to is decided from the swap target.
        this.onDocument('htmx:responseError', event => this.onResponseError(event))

        // beforeSwap, by contrast, is fired on the swap target itself, so it always bubbles through this
        // region whenever this region (or anything inside it) is replaced.
        this.on('htmx:beforeSwap', event => this.onBeforeSwap(event))
    }

    private onResponseError(event: Event): void {
        const detail = detailOf(event)
        if (!detail) return

        // isOwn resolves the swap target to its nearest enclosing region, so a failure inside a grid
        // nested in a detail panel is left to that grid's own instance.
        if (!this.isOwn(detail.target ?? null)) return

        // Only a failure that was going to replace the rows makes them stale. A rejected cell save
        // targets a single <tr> and reports itself in the editor.
        if (detail.target !== this.el) return

        const status = detail.xhr?.status ?? 0
        this.show(
            status === 403
                ? 'You do not have permission to view this data.'
                : `Could not load data (HTTP ${status}). The rows below are from the previous query.`,
        )
    }

    /**
     * Hide the bar when incoming content replaces the ground it stands on, so a load that succeeds
     * clears the previous failure.
     *
     * htmx fires beforeSwap for error responses too, and fires it before responseError, so a second
     * consecutive failure hides the bar here and `onResponseError` re-raises it with the newer message.
     */
    private onBeforeSwap(event: Event): void {
        const bar = this.bar()
        if (!bar) return

        // Guarded on containment rather than ownership of the target: swaps landing on a single row (an
        // inline cell save, a virtual-scroll block append) also bubble through this region, and they
        // leave the bar in place because they do not re-answer the query that failed.
        const target = swapTargetOf(event)
        if (target && target !== bar && target.contains(bar)) bar.hidden = true
    }

    /**
     * The error bar, once something has raised one.
     *
     * Scoped to a direct child, which is where `show` puts it. An unscoped lookup would reach into a
     * grid nested in a detail panel and write this grid's message into the wrong region.
     */
    private bar(): HTMLElement | null {
        return this.find<HTMLElement>(':scope > .rg-error')
    }

    private show(message: string): void {
        let bar = this.bar()
        if (!bar) {
            bar = document.createElement('div')
            bar.className = 'rg-error'
            bar.setAttribute('role', 'alert')
            this.el.prepend(bar)
        }
        bar.textContent = message
        bar.hidden = false
    }
}
