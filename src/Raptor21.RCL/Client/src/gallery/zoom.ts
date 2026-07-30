/**
 * Pinch / double-tap / wheel zoom for a single image.
 *
 * While an image is zoomed the deck must not steal the gesture, since panning a magnified image is also
 * a horizontal drag. `isZoomed()` lets the carousel yield, and both it and the viewer return to normal
 * as soon as the user zooms back out.
 */
const MAX_SCALE = 6
const MIN_SCALE = 1

export class ZoomableImage {
    private scale = 1
    private tx = 0
    private ty = 0
    private startDistance = 0
    private startScale = 1
    private panning = false
    private panStartX = 0
    private panStartY = 0
    private lastTap = 0
    private readonly pointers = new Map<number, PointerEvent>()
    private readonly cleanups: Array<() => void> = []

    constructor(private readonly host: HTMLElement, private readonly img: HTMLImageElement) {
        this.bind()
    }

    isZoomed(): boolean {
        return this.scale > MIN_SCALE + 0.01
    }

    private bind(): void {
        const add = (target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
            target.addEventListener(type, fn, opts)
            this.cleanups.push(() => target.removeEventListener(type, fn, opts))
        }

        add(this.host, 'pointerdown', (e: Event) => this.onDown(e as PointerEvent))
        add(this.host, 'pointermove', (e: Event) => this.onMove(e as PointerEvent), { passive: false })
        add(this.host, 'pointerup', (e: Event) => this.onUp(e as PointerEvent))
        add(this.host, 'pointercancel', (e: Event) => this.onUp(e as PointerEvent))
        add(this.host, 'dblclick', (e: Event) => { e.preventDefault(); this.toggle(e as MouseEvent) })
        add(this.host, 'wheel', (e: Event) => this.onWheel(e as WheelEvent), { passive: false })
    }

    private onDown(e: PointerEvent): void {
        this.pointers.set(e.pointerId, e)

        if (this.pointers.size === 2) {
            const [a, b] = [...this.pointers.values()]
            this.startDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
            this.startScale = this.scale
            return
        }

        // Double-tap: the phone equivalent of double-click, which pointer events do not synthesise.
        const now = Date.now()
        if (now - this.lastTap < 300 && e.pointerType !== 'mouse') {
            this.toggle(e)
            this.lastTap = 0
            return
        }
        this.lastTap = now

        if (this.isZoomed()) {
            this.panning = true
            this.panStartX = e.clientX - this.tx
            this.panStartY = e.clientY - this.ty
        }
    }

    private onMove(e: PointerEvent): void {
        if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, e)

        if (this.pointers.size === 2 && this.startDistance > 0) {
            // Pinch: the browser would otherwise page-zoom the whole document.
            e.preventDefault()
            const [a, b] = [...this.pointers.values()]
            const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
            this.setScale(this.startScale * (distance / this.startDistance))
            return
        }

        if (this.panning && this.isZoomed()) {
            // Only claim the gesture while magnified; otherwise the deck needs it to change slides.
            e.preventDefault()
            this.tx = e.clientX - this.panStartX
            this.ty = e.clientY - this.panStartY
            this.clamp()
            this.apply()
        }
    }

    private onUp(e: PointerEvent): void {
        this.pointers.delete(e.pointerId)
        if (this.pointers.size < 2) this.startDistance = 0
        if (this.pointers.size === 0) this.panning = false
    }

    private onWheel(e: WheelEvent): void {
        if (!e.ctrlKey && !this.isZoomed()) return
        // ctrl+wheel is the desktop pinch; once zoomed, a plain wheel keeps zooming rather than
        // scrolling the page out from under the image.
        e.preventDefault()
        this.setScale(this.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
    }

    private toggle(e: { clientX: number; clientY: number }): void {
        if (this.isZoomed()) {
            this.reset()
            return
        }
        // Zoom toward the tapped point rather than the centre, so a corner remains reachable.
        const rect = this.host.getBoundingClientRect()
        const target = 2.5
        this.scale = target
        this.tx = (rect.width / 2 - (e.clientX - rect.left)) * (target - 1)
        this.ty = (rect.height / 2 - (e.clientY - rect.top)) * (target - 1)
        this.clamp()
        this.apply()
    }

    private setScale(next: number): void {
        this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
        if (!this.isZoomed()) { this.tx = 0; this.ty = 0 }
        this.clamp()
        this.apply()
    }

    /** Keeps the magnified image covering the stage, so it can never be dragged off into blank space. */
    private clamp(): void {
        const rect = this.host.getBoundingClientRect()
        const maxX = Math.max(0, (rect.width * this.scale - rect.width) / 2)
        const maxY = Math.max(0, (rect.height * this.scale - rect.height) / 2)
        this.tx = Math.min(maxX, Math.max(-maxX, this.tx))
        this.ty = Math.min(maxY, Math.max(-maxY, this.ty))
    }

    private apply(): void {
        this.img.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`
        this.host.classList.toggle('rg-gal-zoomed', this.isZoomed())
    }

    reset(): void {
        this.scale = 1
        this.tx = 0
        this.ty = 0
        this.apply()
    }

    destroy(): void {
        for (const off of this.cleanups.splice(0)) off()
    }
}
