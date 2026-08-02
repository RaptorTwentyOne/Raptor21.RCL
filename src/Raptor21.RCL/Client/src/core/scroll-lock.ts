/**
 * Page scroll lock, safe to nest.
 *
 * The lock is counted rather than boolean, so a confirm dialog opened over a form modal does not unlock
 * the page when it alone closes. The scrollbar's width is compensated while locked, so locking does not
 * shift the layout underneath the overlay.
 *
 * THE COMPENSATION HAS TWO HALVES, AND ONLY ONE OF THEM CAN BE A PADDING.
 * Hiding the page's overflow takes a classic scrollbar off the screen, and that does not merely free
 * some space — it WIDENS THE VIEWPORT, which is the containing block of every `position: fixed` element
 * in the document, top layer included. `padding-right` on `<body>` answers for normal-flow content and
 * for nothing else. Measured (Chrome 150, real bundles, /roles, the app's own
 * `::-webkit-scrollbar { width: 5px }` making the root scrollbar a classic one): with a toast on screen
 * and a modal then taking the lock, `documentElement.clientWidth` went 1795 → 1800 and the toast stack —
 * `position: fixed; right: 1rem`, in the top layer — moved from x = 1459 to x = 1464 and back again on
 * unlock. The same 5px moved the mobile bar's trailing edge (381 → 386), and with it the "…" trigger
 * (x 329 → 334) and the page-chrome menu anchored to that trigger: a menu the user is looking at jumps
 * sideways the instant a sheet opens inside it.
 *
 * So the gap is ALSO published as `--rg-scroll-gutter` on `<html>`, and the surfaces that resolve
 * against the viewport subtract it themselves (`styles/_tokens.scss` documents the token and lists
 * today's readers). A property rather than a per-surface pass in script: the set of viewport-pinned
 * surfaces is open — the library's own, plus whatever fixed chrome the HOST renders — and a stylesheet
 * rule is the only thing that can reach a box this module has never heard of.
 *
 * REJECTED, MEASURED: `scrollbar-gutter: stable`, which exists for exactly this and would need no
 * cooperation from anybody. It does not survive the lock. On `<html>` with the overflow hidden on
 * `<body>` (today's lock) `clientWidth` still went 1795 → 1800; moving the `overflow: hidden` onto
 * `<html>` as well, so the root is unambiguously the scroll container, gave 1800 too. The reserved
 * gutter is dropped along with the scrollbar in both arrangements, so there is nothing to keep the
 * viewport at its old width.
 */

/** Where the compensation is published. `<html>`, not `<body>`: a fixed element is not necessarily a
 *  descendant of the body's box in any useful sense, but every element inherits from the root. */
const GUTTER_PROP = '--rg-scroll-gutter'

let depth = 0
let restore: { overflow: string; paddingRight: string } | null = null

export function lockScroll(): void {
    if (depth++ > 0) return

    const body = document.body
    restore = { overflow: body.style.overflow, paddingRight: body.style.paddingRight }

    const gap = Math.max(0, window.innerWidth - document.documentElement.clientWidth)
    if (gap > 0) {
        const current = parseFloat(getComputedStyle(body).paddingRight) || 0
        body.style.paddingRight = `${current + gap}px`
    }
    // Written unconditionally, `0px` included: "the lock is held and it cost nothing" is a different
    // statement from "no lock is held", and a surface reading the property must not have to tell the
    // difference. On a platform with overlay scrollbars — every phone, and macOS by default — the gap
    // is always 0 and every `calc()` below reduces to the value it already had.
    document.documentElement.style.setProperty(GUTTER_PROP, `${gap}px`)
    body.style.overflow = 'hidden'
}

export function unlockScroll(): void {
    if (depth === 0) return
    if (--depth > 0) return

    const body = document.body
    body.style.overflow = restore?.overflow ?? ''
    body.style.paddingRight = restore?.paddingRight ?? ''
    restore = null
    // Removed rather than set to 0px, so the value falls back to the `:root` declaration in
    // `styles/_tokens.scss` — one place states the neutral value, and a host that re-points it keeps it.
    document.documentElement.style.removeProperty(GUTTER_PROP)
}

/** Drops every lock. Used when a whole overlay layer is torn down at once. */
export function resetScrollLock(): void {
    if (depth === 0) return
    // Collapse however many locks are held into one, then release it through the ordinary unlock path,
    // so the body style restore lives in exactly one place. Zeroing `depth` first would trip
    // unlockScroll's own already-unlocked guard and leave `overflow: hidden` stuck on the body.
    depth = 1
    unlockScroll()
}
