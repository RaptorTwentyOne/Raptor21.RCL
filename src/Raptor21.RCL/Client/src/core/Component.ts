import { qsa } from './dom'

/**
 * Base for every Raptor component.
 *
 * A component owns one element, binds its listeners through the helpers below, and is destroyed when
 * that element leaves the document. Listener bookkeeping is centralised here so that a swapped-out
 * region cannot leave handlers behind.
 */
export abstract class RaptorComponent<TEl extends HTMLElement = HTMLElement> {
    private readonly bindings: Array<() => void> = []
    private destroyed = false

    constructor(readonly el: TEl) {}

    /** Called once after construction. Set up listeners and initial state here. */
    abstract mount(): void

    /** Listener scoped to this component's element; removed automatically on destroy. */
    protected on<K extends keyof HTMLElementEventMap>(
        type: K,
        handler: (event: HTMLElementEventMap[K]) => void,
        options?: AddEventListenerOptions,
    ): void {
        this.bind(this.el, type as string, handler as EventListener, options)
    }

    /**
     * Listener on the document, for interactions that escape the element — a drag that continues over
     * the page, a keystroke while a popup is open. Cleaned up on destroy like the rest.
     */
    protected onDocument(type: string, handler: EventListener, options?: AddEventListenerOptions): void {
        this.bind(document, type, handler, options)
    }

    protected onWindow(type: string, handler: EventListener, options?: AddEventListenerOptions): void {
        this.bind(window, type, handler, options)
    }

    protected bind(target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions): void {
        target.addEventListener(type, handler, options)
        this.bindings.push(() => target.removeEventListener(type, handler, options))
    }

    /** Registers arbitrary teardown (observers, timers) alongside the listeners. */
    protected onDestroy(dispose: () => void): void {
        this.bindings.push(dispose)
    }

    protected find<T extends Element = HTMLElement>(selector: string): T | null {
        return this.el.querySelector<T>(selector)
    }

    protected findAll<T extends Element = HTMLElement>(selector: string): T[] {
        return qsa<T>(this.el, selector)
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        for (const dispose of this.bindings.splice(0)) {
            try {
                dispose()
            } catch (error) {
                console.error('[raptor21] teardown failed', error)
            }
        }
    }
}
