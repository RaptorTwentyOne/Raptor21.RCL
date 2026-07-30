/**
 * The slide deck.
 *
 * Built on CSS scroll-snap rather than a carousel library, so horizontal swipe, momentum and snapping
 * are the browser's own scrolling and no dependency ships with it. Arrows, bullets and arrow-key
 * navigation are the only parts implemented here.
 *
 * The one thing scroll-snap does not provide is which slide is current; that is derived from the scroll
 * offset once movement settles.
 */
export interface CarouselHooks {
    /** Fired after the active slide settles, so the owner can sync thumbnails and lazy content. */
    onChange?(index: number): void

    /** Lets an interactive slide (a magnified drawing) refuse a horizontal drag. */
    canDrag?(index: number): boolean
}

export class Carousel {
    private index = 0
    private settleTimer = 0
    private frame = 0
    private dragFrame = 0
    private pendingDragX: number | null = null
    private readonly cleanups: Array<() => void> = []

    constructor(
        private readonly track: HTMLElement,
        private readonly hooks: CarouselHooks = {},
    ) {
        this.watchSlides()
        this.bindKeys()
        this.bindDrag()
    }

    get current(): number {
        return this.index
    }

    get count(): number {
        return this.track.children.length
    }

    goTo(index: number, smooth = true): void {
        const clamped = Math.min(Math.max(index, 0), this.count - 1)
        const target = this.track.children[clamped] as HTMLElement | undefined
        if (!target) return

        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        this.animateTo(target.offsetLeft, smooth && !reduce)

        // Report the destination straight away. Waiting for the scroll to settle makes the thumbnails
        // and counter lag a click behind, and an interrupted scroll never reports at all.
        this.setIndex(clamped)
    }

    /**
     * Scrolls the deck, animating in JS rather than through `scrollTo({behavior:'smooth'})`.
     *
     * The native smooth behaviour does not always take effect on a freshly-built deck, leaving the state
     * advanced while the track stays put. Driving the movement here also makes it cancellable when a new
     * jump interrupts the last one.
     */
    private animateTo(left: number, smooth: boolean): void {
        cancelAnimationFrame(this.frame)

        if (!smooth) {
            this.track.scrollLeft = left;
            return
        }

        const from = this.track.scrollLeft
        const distance = left - from
        if (Math.abs(distance) < 1) return

        const duration = Math.min(420, Math.max(180, Math.abs(distance) * 0.4))
        const start = performance.now()
        // easeOutCubic: quick to leave, gentle to arrive.
        const ease = (t: number) => 1 - Math.pow(1 - t, 3)

        const step = (now: number) => {
            const progress = Math.min(1, (now - start) / duration)
            this.track.scrollLeft = from + distance * ease(progress)
            if (progress < 1) this.frame = requestAnimationFrame(step)
        }
        this.frame = requestAnimationFrame(step)
    }

    next(): void {
        this.goTo(this.index + 1)
    }

    prev(): void {
        this.goTo(this.index - 1)
    }

    /**
     * The active slide is derived from the scroll position once scrolling settles.
     *
     * Measuring the scroll offset rather than observing intersections needs no thresholds and, because
     * it is recomputed from live geometry, stays correct after a resize or an orientation change.
     */
    private watchSlides(): void {
        const settle = () => {
            window.clearTimeout(this.settleTimer)
            // Momentum scrolling fires continuously; report once the finger and the deck have stopped.
            this.settleTimer = window.setTimeout(() => this.setIndex(this.nearestIndex()), 90)
        }

        this.track.addEventListener('scroll', settle, {passive: true})
        window.addEventListener('resize', settle)
        window.addEventListener('orientationchange', settle)
        this.cleanups.push(() => {
            window.clearTimeout(this.settleTimer)
            this.track.removeEventListener('scroll', settle)
            window.removeEventListener('resize', settle)
            window.removeEventListener('orientationchange', settle)
        })
    }

    /** The slide whose left edge sits closest to the current scroll offset. */
    private nearestIndex(): number {
        const left = this.track.scrollLeft
        let best = 0
        let bestGap = Number.POSITIVE_INFINITY
        for (let i = 0; i < this.count; i++) {
            const gap = Math.abs((this.track.children[i] as HTMLElement).offsetLeft - left)
            if (gap < bestGap) {
                bestGap = gap;
                best = i
            }
        }
        return best
    }

    private setIndex(next: number): void {
        if (next < 0 || next === this.index) return
        this.index = next
        this.hooks.onChange?.(next)
    }

    private bindKeys(): void {
        const onKey = (event: Event) => {
            const e = event as KeyboardEvent
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.next()
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.prev()
            }
        }
        this.track.addEventListener('keydown', onKey)
        this.cleanups.push(() => this.track.removeEventListener('keydown', onKey))
    }

    /**
     * Pointer drag for mouse users; touch already scrolls natively.
     *
     * An interactive slide (3D, 360, a magnified image) opts out through `canDrag`, which suppresses
     * only this drag. Native touch scrolling and the edge gutters the stylesheet leaves either side keep
     * working, so such a slide can always be swiped away from.
     */
    private bindDrag(): void {
        let down = false
        let startX = 0
        let startScroll = 0

        const onDown = (event: Event) => {
            const e = event as PointerEvent
            if (e.pointerType !== 'mouse' || !e.isPrimary) return
            if (this.hooks.canDrag && !this.hooks.canDrag(this.index)) return
            down = true
            startX = e.clientX
            startScroll = this.track.scrollLeft
            this.track.classList.add('rg-gal-dragging')
        }
        // pointermove fires more often than a frame can paint, so the scrollLeft write is coalesced into
        // one rAF per frame.
        const applyDrag = () => {
            this.dragFrame = 0
            if (this.pendingDragX === null) return
            this.track.scrollLeft = startScroll - (this.pendingDragX - startX)
            this.pendingDragX = null
        }
        const onMove = (event: Event) => {
            if (!down) return
            const e = event as PointerEvent
            this.pendingDragX = e.clientX
            if (!this.dragFrame) this.dragFrame = requestAnimationFrame(applyDrag)
        }
        const onUp = () => {
            if (!down) return
            down = false
            this.track.classList.remove('rg-gal-dragging')
            // Flush any pending frame so the landing calculation below uses the exact release position.
            if (this.dragFrame) {
                cancelAnimationFrame(this.dragFrame)
                this.dragFrame = 0
            }
            applyDrag()
            // Land on a slide: scroll-snap only settles on its own after a native scroll gesture.
            this.goTo(Math.round(this.track.scrollLeft / Math.max(this.track.clientWidth, 1)))
        }

        this.track.addEventListener('pointerdown', onDown)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
        this.cleanups.push(() => {
            this.track.removeEventListener('pointerdown', onDown)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onUp)
        })
    }

    destroy(): void {
        cancelAnimationFrame(this.frame)
        cancelAnimationFrame(this.dragFrame)
        for (const off of this.cleanups.splice(0)) off()
    }
}
