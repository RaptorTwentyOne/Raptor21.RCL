import type { SpinItem } from './types'

/**
 * Drag-to-rotate 360° viewer.
 *
 * <b>Vertical scrolling keeps working.</b> The element declares `touch-action: pan-y`, so the browser
 * keeps vertical panning while the horizontal gesture is handled here. No `preventDefault()` is called
 * on touch moves, so the page is never scroll-hijacked.
 *
 * <b>Frames load progressively.</b> The first frame is shown at once and the rest are fetched a few at a
 * time, so the viewer is usable immediately and a large frame set never floods the connection.
 */
export class Spin360 {
    private readonly img: HTMLImageElement
    private readonly frames: string[]
    private current = 0
    private dragging = false
    private startX = 0
    private startFrame = 0
    private loaded = 0
    private disposed = false
    private readonly cleanups: Array<() => void> = []

    constructor(private readonly host: HTMLElement, item: SpinItem) {
        this.frames = item.frames

        this.host.classList.add('rg-gal-spin')
        this.host.innerHTML =
            '<img class="rg-gal-spin-img" draggable="false" alt="">' +
            '<div class="rg-gal-spin-hint" aria-hidden="true">' +
            '<span class="rg-gal-spin-hint-icon"></span><span>Drag to rotate</span></div>' +
            '<div class="rg-gal-spin-progress"><i style="width:0%"></i></div>'

        this.img = this.host.querySelector('.rg-gal-spin-img') as HTMLImageElement
        this.img.alt = item.alt ?? '360° view'
        this.img.src = this.frames[0]

        this.bind()
        void this.preload()
    }

    private bind(): void {
        const add = (target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
            target.addEventListener(type, fn, opts)
            this.cleanups.push(() => target.removeEventListener(type, fn, opts))
        }

        add(this.host, 'pointerdown', (e: Event) => this.onDown(e as PointerEvent))
        add(this.host, 'pointermove', (e: Event) => this.onMove(e as PointerEvent))
        add(this.host, 'pointerup', (e: Event) => this.onUp(e as PointerEvent))
        // pointercancel too: the browser fires it instead of pointerup when it takes the gesture over
        // (a scroll wins, the app backgrounds), and without it the viewer stays stuck in dragging.
        add(this.host, 'pointercancel', (e: Event) => this.onUp(e as PointerEvent))
        add(this.img, 'dragstart', e => e.preventDefault())
    }

    private onDown(e: PointerEvent): void {
        if (!e.isPrimary) return
        this.dragging = true
        this.startX = e.clientX
        this.startFrame = this.current
        this.host.classList.add('rg-gal-spin-active')
        // Capture so a drag that leaves the element keeps rotating.
        try { this.host.setPointerCapture(e.pointerId) } catch { /* capture is best-effort */ }
    }

    private onMove(e: PointerEvent): void {
        if (!this.dragging) return

        // Sensitivity scales with the viewport rather than using a fixed pixels-per-frame constant: a
        // drag across ~70% of the stage is one full rotation on every screen size.
        const span = Math.max(this.host.clientWidth * 0.7, 160)
        const perFrame = Math.max(span / this.frames.length, 2)
        const offset = Math.round((e.clientX - this.startX) / perFrame)

        this.setFrame(this.startFrame + offset)
    }

    private onUp(e: PointerEvent): void {
        if (!this.dragging) return
        this.dragging = false
        this.host.classList.remove('rg-gal-spin-active')
        // Guarded: on pointercancel the browser has already released capture and releasing again throws.
        try {
            if (this.host.hasPointerCapture?.(e.pointerId)) this.host.releasePointerCapture(e.pointerId)
        } catch { /* already released */ }
    }

    /** Wrap-around uses the double modulo so a negative index lands at the end, not at NaN. */
    private setFrame(index: number): void {
        if (this.disposed) return
        const n = this.frames.length
        const next = ((index % n) + n) % n
        if (next === this.current) return
        this.current = next
        this.img.src = this.frames[next]
        this.host.classList.add('rg-gal-spin-touched')
    }

    /** First frame immediately, the rest in small waves so the network is never flooded. */
    private async preload(): Promise<void> {
        const bar = this.host.querySelector('.rg-gal-spin-progress i') as HTMLElement | null
        const batch = 6

        for (let i = 0; i < this.frames.length; i += batch) {
            if (this.disposed) return
            await Promise.all(
                this.frames.slice(i, i + batch).map(src => new Promise<void>(resolve => {
                    const image = new Image()
                    // Resolve on error too: one missing frame must not stall the remaining ones.
                    image.onload = image.onerror = () => { this.loaded++; resolve() }
                    image.src = src
                })),
            )
            if (bar) bar.style.width = `${Math.round((this.loaded / this.frames.length) * 100)}%`
        }

        this.host.classList.add('rg-gal-spin-ready')
    }

    destroy(): void {
        this.disposed = true
        for (const off of this.cleanups.splice(0)) off()
    }
}
