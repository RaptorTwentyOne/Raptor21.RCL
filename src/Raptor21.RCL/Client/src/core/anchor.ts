export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'

export interface AnchorOptions {
    placement?: Placement
    /** Gap between the anchor and the panel, in px. */
    offset?: number
    /** Stretch the panel to at least the anchor's width. */
    matchWidth?: boolean
    /** Keep the panel within the viewport, flipping and shifting as needed. */
    constrain?: boolean
}

/**
 * Positions a floating panel against an anchor.
 *
 * Uses `position: fixed` with viewport coordinates. Absolute positioning inside the anchor's offset
 * parent would inherit every `overflow: hidden` and transform between the anchor and the root, which is
 * the situation inside a scrolling grid or a modal. Fixed coordinates are immune to the ancestor chain,
 * in exchange for having to be recomputed on scroll — see `trackAnchor`.
 */
export function positionAt(panel: HTMLElement, anchor: Element, options: AnchorOptions = {}): void {
    const {placement = 'bottom-start', offset = 4, matchWidth = false, constrain = true} = options

    const a = anchor.getBoundingClientRect()

    panel.style.position = 'fixed'
    if (matchWidth) panel.style.minWidth = `${Math.round(a.width)}px`

    panel.style.visibility = 'hidden'
    panel.style.top = '0'
    panel.style.left = '0'
    const p = panel.getBoundingClientRect()
    panel.style.visibility = ''

    const margin = 8
    const viewportW = document.documentElement.clientWidth
    const viewportH = document.documentElement.clientHeight

    let wantsTop = placement.startsWith('top')
    if (constrain) {
        const below = viewportH - a.bottom - offset
        const above = a.top - offset
        if (!wantsTop && p.height > below && above > below) wantsTop = true
        else if (wantsTop && p.height > above && below > above) wantsTop = false
    }

    let top = wantsTop ? a.top - p.height - offset : a.bottom + offset
    let left = placement.endsWith('end') ? a.right - p.width : a.left

    if (constrain) {
        left = Math.min(Math.max(margin, left), Math.max(margin, viewportW - p.width - margin))
        top = Math.min(Math.max(margin, top), Math.max(margin, viewportH - p.height - margin))
    }

    panel.style.top = `${Math.round(top)}px`
    panel.style.left = `${Math.round(left)}px`
}

/**
 * Re-runs positioning while the panel is open.
 *
 * Fixed coordinates are a snapshot: any scroll or resize between opening and closing leaves the panel
 * behind. Capture-phase scroll catches ancestor scrollers too, not just the window.
 */
export function trackAnchor(panel: HTMLElement, anchor: Element, options: AnchorOptions = {}): () => void {
    let raf = 0
    const reposition = (): void => {
        if (raf) return
        raf = requestAnimationFrame(() => {
            raf = 0
            positionAt(panel, anchor, options)
        })
    }

    window.addEventListener('scroll', reposition, {capture: true, passive: true})
    window.addEventListener('resize', reposition, {passive: true})

    return () => {
        window.removeEventListener('scroll', reposition, {capture: true})
        window.removeEventListener('resize', reposition)
        if (raf) {
            cancelAnimationFrame(raf)
            raf = 0
        }
    }
}
