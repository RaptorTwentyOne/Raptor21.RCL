import type { GridComponent } from './GridComponent'

/**
 * One behaviour of a grid — pinning, resizing, inline edit, and so on.
 *
 * Features bind through the owning component, so teardown stays in one place: when the region is
 * swapped, every feature's listeners go with it.
 */
export abstract class GridFeature {
    constructor(protected readonly grid: GridComponent) {}

    /** Called once when the grid mounts. */
    abstract init(): void

    /** The grid's region element. */
    protected get el(): HTMLElement {
        return this.grid.el
    }

    protected on(type: string, handler: EventListener, options?: AddEventListenerOptions): void {
        this.grid.track(this.el, type, handler, options)
    }

    protected onDocument(type: string, handler: EventListener, options?: AddEventListenerOptions): void {
        this.grid.track(document, type, handler, options)
    }

    protected onWindow(type: string, handler: EventListener, options?: AddEventListenerOptions): void {
        this.grid.track(window, type, handler, options)
    }

    protected onDestroy(dispose: () => void): void {
        this.grid.trackDispose(dispose)
    }

    protected find<T extends Element = HTMLElement>(selector: string): T | null {
        return this.el.querySelector<T>(selector)
    }

    protected findAll<T extends Element = HTMLElement>(selector: string): T[] {
        return [...this.el.querySelectorAll<T>(selector)]
    }

    /** True when the event happened inside this grid rather than a nested one. */
    protected isOwn(target: EventTarget | null): boolean {
        return target instanceof Element && target.closest('.raptor-grid') === this.el
    }
}
