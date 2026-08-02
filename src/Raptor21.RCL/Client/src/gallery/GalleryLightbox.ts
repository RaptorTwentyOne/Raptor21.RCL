import { Gallery } from './Gallery'
import { closeDialog, isTopDialog, openDialog } from '../core/dialog-stack'
import { reseatTopLayerGuests, topLayerHost } from '../core/dom'
import { lockScroll, unlockScroll } from '../core/scroll-lock'
import { modalContainer } from '../modal/container'
import { PAGE_RESTORE_EVENT } from '../runtime/page-lifecycle'
import { buildSlides, type GallerySource, type ProductImage } from './types'

/**
 * Full-screen media overlay.
 *
 * Self-contained: it builds and owns its own dialog rather than calling into the host application's
 * modal implementation, so the gallery carries no dependency on one.
 *
 * On a phone it fills the viewport (including the dynamic toolbar, via `100dvh`) so the picture gets
 * the whole screen instead of a floating panel with margins.
 *
 * IT IS A MODAL, AND IT IS IN THE TOP LAYER. It used to be a `<div>` at `--rg-z-modal` (400) appended
 * to `<body>` — the normal layer — and that was measured to be no layer at all next to anything else
 * this library opens. Chrome 390x844, the real bundles: with one `.rg-modal` `<dialog>` open,
 * `elementsFromPoint` at the CENTRE of the lightbox's own `{0, 0, 390, 844}` rect returned
 * `[DIALOG#m1.rg-modal, HTML]` — the lightbox did not appear in its own centre at all. With the rail
 * open it painted under the rail and under the rail's scrim for the same reason. There is no z-index
 * that reaches the top layer from outside it (measured across 300…2147483647, see modal/open.ts), so
 * the only fix is to join it.
 *
 * WHY MODAL AND NOT OFF-CANVAS — the choice the layer question actually turns on. An off-canvas surface
 * (the sidebar rail) coexists with the page: the page underneath stays visible, stays scrollable, and a
 * touch outside dismisses it, which is exactly what `popover="auto"` gives. This surface asks for the
 * opposite on all three counts, and it asked for them before this change: it draws a full-viewport
 * scrim over everything, it locks page scroll, and it already declared `aria-modal="true"` on its
 * panel. A picture opened full-screen is a task the user is in, not a menu they are passing through.
 * `<dialog>.showModal()` is the mechanism that states that — it supplies the top layer, the inertness
 * of everything behind, and focus containment, none of which the hand-rolled version had.
 *
 * The consequence to keep in mind is that opening one now CLOSES an open `auto` popover (the rail), by
 * the UA's own rule. That is the same thing every `.rg-modal` does and it is the correct reading: a
 * full-screen viewer and an open navigation drawer are not a coherent state.
 */
export class GalleryLightbox {
    private static open?: GalleryLightbox

    private readonly overlay: HTMLElement
    private gallery?: Gallery
    private readonly onKey: (e: KeyboardEvent) => void
    private readonly onRestore: () => void
    private closed = false

    private constructor(title: string) {
        this.overlay = document.createElement('dialog')
        this.overlay.className = 'rg-gal-lightbox'
        // On the dialog itself, and set as an attribute rather than interpolated into the markup below:
        // the title comes from a `data-` attribute a consumer wrote, and the template literal it used to
        // sit in escaped nothing. `role="dialog"`/`aria-modal` are gone with it — a `<dialog>` shown with
        // `showModal()` carries both implicitly, and stating them on the inner panel now would announce a
        // second dialog inside the first.
        this.overlay.setAttribute('aria-label', title || 'Media')
        this.overlay.innerHTML = `
            <div class="rg-gal-panel">
                <div class="rg-gal-lightbox-head">
                    <span class="rg-gal-lightbox-title"></span>
                    <span class="rg-gal-lightbox-actions">
                        <button type="button" class="rg-gal-lightbox-expand" aria-label="Expand" title="Expand"></button>
                        <button type="button" class="rg-gal-lightbox-close" aria-label="Close" title="Close"></button>
                    </span>
                </div>
                <div class="rg-gal-lightbox-body"><div class="rg-gal-loading">Loading…</div></div>
            </div>`
        ;(this.overlay.querySelector('.rg-gal-lightbox-title') as HTMLElement).textContent = title

        this.overlay.addEventListener('click', e => {
            const el = e.target as HTMLElement
            if (el.closest('.rg-gal-lightbox-close')) { this.close(); return }
            if (el.closest('.rg-gal-lightbox-expand')) { this.toggleExpand(); return }
            // Backdrop click closes. Only a click on the overlay itself counts — one that lands on the
            // panel, or a drag that merely ended over the backdrop, must not. The dialog element spans
            // the viewport (`inset: 0`), so the padding around the panel is still this element and the
            // test is unchanged by the move to `<dialog>`; the UA `::backdrop` is never an event target.
            if (el === this.overlay) this.close()
        })

        // Escape, the UA's way. `cancel` fires on the close watcher's target, which is the top-most
        // dialog, so it needs no gate of its own. `preventDefault()` because dismissal here means
        // REMOVING the element (see `close`) and letting the UA close it first would leave a
        // closed-but-present dialog for one turn of the event loop.
        this.overlay.addEventListener('cancel', e => {
            e.preventDefault()
            this.close()
        })

        // Escape, the document way, KEPT ALONGSIDE `cancel` for the reason ModalComponent keeps its own:
        // a bare `<dialog>.showModal()` probe given a trusted Escape was measured staying OPEN and
        // firing neither `cancel` nor `close`, so the close watcher cannot be relied on alone.
        //
        // Gated on the shared stack. Ungated it was measured closing this overlay together with a
        // `.rg-modal` opened over it — one trusted Escape, two dialogs dismissed, and the body left
        // `overflow: hidden`.
        this.onKey = e => {
            if (e.key === 'Escape' && isTopDialog(this.overlay)) this.close()
        }
        document.addEventListener('keydown', this.onKey)

        // A back/forward restore swaps `#app-root`, and this overlay is outside it: without this it
        // would survive the navigation floating over the restored page in the top layer, holding a
        // scroll lock that the restore chain's `resetScrollLock` has already collapsed. Same contract
        // ModalComponent and NotifyManager.confirm follow, restore-only by the same design.
        this.onRestore = () => this.close()
        document.addEventListener(PAGE_RESTORE_EVENT, this.onRestore)

        // Grouped with every other imperatively-built dialog rather than dropped on `<body>`. Placement
        // only — a `<dialog>` in the top layer resolves its geometry against the viewport wherever it
        // sits (modal/container.ts) — but a single host keeps document order and opening order agreeing
        // for anything that has to scan for dialogs.
        modalContainer().appendChild(this.overlay)
        openDialog(this.overlay)

        // Adopt the always-on surfaces INTO this dialog. `showModal()` makes every non-descendant inert,
        // top-layer elements included, so an error toast (`duration: 0`, dismissed only by its own
        // button) left outside would be visible and dead for as long as the viewer is open.
        reseatTopLayerGuests(this.overlay)

        // THE COUNTED LOCK, not `document.body.style.overflow` directly — which is what this did, and it
        // was the only writer outside core/scroll-lock.ts. Measured sequence for the leak it caused:
        // lightbox opens and snapshots `previousOverflow: ""`, sets `hidden`; a modal opens and
        // `lockScroll()` takes its depth 0→1 snapshot of a body that ALREADY reads `hidden`; both close;
        // the modal restores `hidden` and the lightbox restores `""` into a body the modal has already
        // overwritten — end state `overflow: hidden` with nothing on screen to release it. Two owners of
        // one property cannot be made to agree; there is now one.
        lockScroll()
    }

    /**
     * Opens the overlay immediately and fills it once the media arrives, so a slow request shows a
     * dialog that is already responding rather than a frozen page.
     */
    static async show(url: string, source: GallerySource): Promise<void> {
        GalleryLightbox.open?.close()
        const box = new GalleryLightbox(source.title ?? 'Media')
        GalleryLightbox.open = box

        try {
            // A POST with no body, authenticated on the session cookie.
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)

            const payload = await response.json()
            // The response envelope nests twice before reaching the rows.
            const rows: ProductImage[] = payload?.data?.data ?? payload?.Data?.Data ?? []
            const { items, spin } = buildSlides(rows, source)

            if (!box.overlay.isConnected) return
            if (!items.length && !spin) { box.message('There is no media for this product.'); return }

            const body = box.overlay.querySelector('.rg-gal-lightbox-body') as HTMLElement
            box.gallery = new Gallery(body, items, spin, { keyboard: true })
        } catch {
            box.message('Media could not be loaded.')
        }
    }

    /**
     * Grows the panel to the full viewport and back.
     *
     * The dialog opens at a moderate size, with the full viewport one click away for media that needs
     * the extra room.
     */
    private toggleExpand(): void {
        this.overlay.classList.toggle('is-expanded')
        const button = this.overlay.querySelector('.rg-gal-lightbox-expand') as HTMLElement | null
        const expanded = this.overlay.classList.contains('is-expanded')
        if (button) {
            button.setAttribute('aria-label', expanded ? 'Restore' : 'Expand')
            button.title = expanded ? 'Restore' : 'Expand'
        }
    }

    private message(text: string): void {
        const body = this.overlay.querySelector('.rg-gal-lightbox-body')
        if (body) body.innerHTML = `<div class="rg-gal-empty">${text}</div>`
    }

    /**
     * Dismisses the viewer.
     *
     * Guarded, and the guard became load-bearing with the counted lock: `close()` is reachable from the
     * × button, the backdrop, Escape, `cancel`, a history restore and `show()`'s replacement of a
     * previous instance, and a second run would decrement a lock this instance no longer holds —
     * unlocking the page underneath a modal that is still open.
     */
    close(): void {
        if (this.closed) return
        this.closed = true

        this.gallery?.destroy()
        document.removeEventListener('keydown', this.onKey)
        document.removeEventListener(PAGE_RESTORE_EVENT, this.onRestore)

        // Out of the top layer and off the stack before the removal, so the next Escape resolves against
        // whatever is underneath. The native `close()` inside also hands focus back to the trigger the
        // user opened this from.
        closeDialog(this.overlay)
        this.overlay.remove()

        // Hand the adopted surfaces to whatever owns the top layer now. Searched FROM the removed
        // element as well: a detached node keeps its children, and that is the only way a still-unread
        // error toast that was adopted in here survives the close.
        reseatTopLayerGuests(topLayerHost(), this.overlay)

        unlockScroll()
        if (GalleryLightbox.open === this) GalleryLightbox.open = undefined
    }
}
