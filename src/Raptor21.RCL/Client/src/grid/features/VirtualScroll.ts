import { GridFeature } from '../GridFeature'

/** The sliver of the htmx global this feature uses. */
interface HtmxTrigger {
    trigger(el: EventTarget, name: string): void
}

function htmxApi(): HtmxTrigger | null {
    return (window as unknown as { htmx?: HtmxTrigger }).htmx ?? null
}

/**
 * Infinite ("virtual") scrolling.
 *
 * The server renders a sentinel row after the last loaded block. When that row nears the viewport we
 * fire its `sgload` htmx trigger, which requests the next block and appends it in place of the
 * sentinel — so paging is server-driven and this feature only decides *when* to ask.
 *
 * A block request rides the REGION endpoint: the sentinel posts the state form with `block=1` in its
 * `hx-vals`, and the server branches on that form field to answer with only the next rows and a fresh
 * sentinel. GridEndpoints.Block is deliberately not used — because the sentinel sits inside the form,
 * the request carries the current filters, sort and column order for free, and the host needs no
 * extra handler.
 *
 * The observation is hand-rolled rather than htmx's own `intersect` trigger because the sentinel must
 * be measured against the grid's own bounded scroll viewport rather than the page: `intersect` cannot
 * take an inner root, and a page carrying several grids needs one root per grid.
 */
export class VirtualScroll extends GridFeature {
    private observer: IntersectionObserver | null = null

    init(): void {
        // A region swap replaces the grid element, so mounting is also the after-a-swap path and the
        // count and sentinel are brought up to date here rather than only on settle. On a first page
        // load this re-derives the label the server already rendered.
        this.updateLoadedCount()
        this.observeSentinel()

        // Re-arm after a failed append: the sentinel is unobserved before the request fires and the
        // settle path never runs for a non-2xx, so one failure would otherwise end infinite scroll
        // until the whole region is swapped.
        this.on('htmx:afterRequest', event => {
            if (!this.isOwn(event.target)) return
            const detail = (event as CustomEvent<{ successful?: boolean } | undefined>).detail
            if (!detail?.successful) this.observeSentinel()
        })

        this.on('htmx:afterSettle', event => {
            if (!this.isOwn(event.target)) return
            this.updateLoadedCount()
            this.observeSentinel()
        })

        this.onDestroy(() => {
            this.observer?.disconnect()
            this.observer = null
        })
    }

    /** Virtual scrolling is opt-in per grid; without it there is no sentinel and no loaded-count label. */
    private get isVirtual(): boolean {
        return this.el.getAttribute('data-rg-virtual') === 'true'
    }

    /**
     * Point the observer at the current sentinel. Safe to call after every settle: the observer is
     * created once per mount, and re-observing a target already being watched is a no-op.
     */
    private observeSentinel(): void {
        if (!this.isVirtual) return

        const scroller = this.grid.scroller
        if (!scroller) return

        if (!this.observer) {
            this.observer = new IntersectionObserver(
                entries => {
                    const htmx = htmxApi()
                    for (const entry of entries) {
                        if (!entry.isIntersecting) continue
                        // Stop watching before firing: the request is in flight while this same row is
                        // still on screen, so leaving it observed would queue the block twice.
                        this.observer?.unobserve(entry.target)
                        htmx?.trigger(entry.target, 'sgload')
                    }
                },
                // Ask a screenful early so the next block lands before the user reaches the end.
                { root: scroller, rootMargin: '250px 0px' },
            )
        }

        const sentinel = this.ownSentinel()
        if (sentinel) this.observer.observe(sentinel)
    }

    /**
     * This grid's sentinel row. A nested grid inside an open detail panel carries a sentinel of its own
     * and can sit above this grid's last row, so the first match in the subtree is not necessarily the
     * right one.
     */
    private ownSentinel(): HTMLElement | null {
        return this.findAll('[data-rg-sentinel]').find(row => this.isOwn(row)) ?? null
    }

    /** Restate "Loaded N of M" from the rows actually present, counting only this grid's own rows. */
    private updateLoadedCount(): void {
        if (!this.isVirtual) return

        const loaded = this.findAll('tbody tr[data-row-key]').filter(row => this.isOwn(row)).length
        const label = this.findAll('[data-rg-loaded]').find(el => this.isOwn(el))
        const totalAttr = Number(this.el.getAttribute('data-rg-total'))
        const totalText = Number.isFinite(totalAttr) ? totalAttr.toLocaleString('en-US') : '?'
        if (label) label.textContent = `Loaded ${loaded.toLocaleString('en-US')} of ${totalText}`
    }
}
