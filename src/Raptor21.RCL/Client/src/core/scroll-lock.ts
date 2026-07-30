/**
 * Page scroll lock, safe to nest.
 *
 * The lock is counted rather than boolean, so a confirm dialog opened over a form modal does not unlock
 * the page when it alone closes. The scrollbar's width is compensated while locked, so locking does not
 * shift the layout underneath the overlay.
 */
let depth = 0
let restore: { overflow: string; paddingRight: string } | null = null

export function lockScroll(): void {
    if (depth++ > 0) return

    const body = document.body
    restore = { overflow: body.style.overflow, paddingRight: body.style.paddingRight }

    const gap = window.innerWidth - document.documentElement.clientWidth
    if (gap > 0) {
        const current = parseFloat(getComputedStyle(body).paddingRight) || 0
        body.style.paddingRight = `${current + gap}px`
    }
    body.style.overflow = 'hidden'
}

export function unlockScroll(): void {
    if (depth === 0) return
    if (--depth > 0) return

    const body = document.body
    body.style.overflow = restore?.overflow ?? ''
    body.style.paddingRight = restore?.paddingRight ?? ''
    restore = null
}

/** Drops every lock. Used when a whole overlay layer is torn down at once. */
export function resetScrollLock(): void {
    depth = 0
    unlockScroll()
    depth = 0
}
