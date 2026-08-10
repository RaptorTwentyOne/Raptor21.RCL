/**
 * Deep-linkable modals, RFC 0001 Part 2(b) — anchor semantics.
 *
 * Modals in this architecture are FETCHED, not pre-rendered: an opener element somewhere on the page
 * carries the hx-get/hx-post that pulls the dialog into the modal container. So a deep link does not
 * need any new modal machinery — it needs to find the opener and press it.
 *
 * A page URL carrying `?modal=<id>` clicks, once the document is ready and htmx is booted, the first
 * element declaring `data-rg-modal-link="<id>"`. The click runs the opener's real behaviour — htmx
 * request, skeleton, dialog stack, permissions on the endpoint — exactly as if the user had pressed it,
 * which is the whole point: the deep link can never open something the page itself could not.
 *
 * NAMING IS DELIBERATELY UNBRANDED. The query parameter (`modal`) and the attribute (`data-rg-*`, the
 * package's established neutral prefix) are host-visible surface — they appear in the host's markup and
 * in URLs its users see and share. Host-visible surface never spells the library brand.
 *
 * No match is a silent no-op: openers are permission-gated server-side, so a link shared with an
 * operator who cannot see the opener simply lands on the page.
 */

const PARAM = 'modal'
const ATTR = 'data-rg-modal-link'

/** CSS.escape with a minimal fallback for engines without it (quotes are the only breaking character
 *  inside a double-quoted attribute selector). */
function escapeForSelector(value: string): string {
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/["\\]/g, '\\$&')
}

function fire(id: string): void {
    const opener = document.querySelector<HTMLElement>(`[${ATTR}="${escapeForSelector(id)}"]`)
    opener?.click()
}

/**
 * Call once htmx is booted (the opener's click is usually an htmx trigger). The extra macrotask after
 * DOMContentLoaded lets htmx finish processing the initial document before the synthetic click.
 */
export function installModalDeepLink(): void {
    const id = new URLSearchParams(window.location.search).get(PARAM)
    if (!id) return

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(() => fire(id), 0), {once: true})
    } else {
        setTimeout(() => fire(id), 0)
    }
}
