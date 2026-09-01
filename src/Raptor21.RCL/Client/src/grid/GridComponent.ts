import { RaptorComponent } from '../core/Component'
import type { GridFeature } from './GridFeature'

type FeatureCtor<T extends GridFeature = GridFeature> = new (grid: GridComponent) => T

/**
 * A server-rendered grid region.
 *
 * The component itself owns almost no behaviour: it resolves the handful of elements every feature
 * needs, then composes the features.
 *
 * Lifecycle is driven by the registry: htmx swaps this region's outerHTML on every filter, sort or page
 * change, which destroys the instance and mounts a fresh one over the new markup. Features therefore
 * must not assume they outlive a request, and anything worth keeping across a swap has to be persisted
 * (the DOM, storage, or the form) rather than held in a field.
 */
export class GridComponent extends RaptorComponent {
    readonly gridId: string
    private readonly features = new Map<FeatureCtor, GridFeature>()
    private layoutRaf = 0

    constructor(el: HTMLElement) {
        super(el)
        this.gridId = el.dataset.gridId ?? ''
    }

    get table(): HTMLTableElement | null {
        return this.el.querySelector<HTMLTableElement>(':scope > .rg-form > .rg-scrollwrap > table')
    }

    get scroller(): HTMLElement | null {
        return this.el.querySelector<HTMLElement>(':scope > .rg-form > .rg-scrollwrap')
    }

    get form(): HTMLFormElement | null {
        return this.el.querySelector<HTMLFormElement>(':scope > .rg-form')
    }

    /** True when this grid is rendered inside another grid's detail panel. */
    get isNested(): boolean {
        return this.el.parentElement?.closest('.raptor-grid') != null
    }

    /** False when the consumer opted out of viewport filling (`FitViewport="false"` -> data-rg-fit="false"). */
    get fitViewport(): boolean {
        return this.el.dataset.rgFit !== 'false'
    }

    /** Mobile stacked-card mode, toggled by the layout feature at the breakpoint. */
    get isCards(): boolean {
        return this.el.classList.contains('rg-cards')
    }

    mount(): void {
        for (const [, feature] of this.features) feature.init()
    }

    /** Registers a feature. Order is preserved: features init in the order they were added. */
    use<T extends GridFeature>(ctor: FeatureCtor<T>): this {
        if (!this.features.has(ctor)) this.features.set(ctor, new ctor(this))
        return this
    }

    /** Reaches a sibling feature, so one behaviour can ask another rather than reimplementing it. */
    feature<T extends GridFeature>(ctor: FeatureCtor<T>): T | null {
        return (this.features.get(ctor) as T | undefined) ?? null
    }

    /**
     * Schedules a relayout, coalescing bursts into one frame. Resize, swap and card-mode changes can
     * all fire together; laying out once per frame keeps that from thrashing.
     */
    requestLayout(): void {
        if (this.layoutRaf) return
        this.layoutRaf = requestAnimationFrame(() => {
            this.layoutRaf = 0
            this.el.dispatchEvent(new CustomEvent('raptor:layout'))
        })
    }

    /** Binding with automatic teardown, exposed for features (see GridFeature). */
    track(target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions): void {
        this.bind(target, type, handler, options)
    }

    trackDispose(dispose: () => void): void {
        this.onDestroy(dispose)
    }

    override destroy(): void {
        if (this.layoutRaf) cancelAnimationFrame(this.layoutRaf)
        this.layoutRaf = 0
        super.destroy()
    }
}
