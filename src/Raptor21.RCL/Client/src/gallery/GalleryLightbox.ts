import { Gallery } from './Gallery'
import { buildSlides, type GallerySource, type ProductImage } from './types'

/**
 * Full-screen media overlay.
 *
 * Self-contained: it builds and owns its own dialog rather than calling into the host application's
 * modal implementation, so the gallery carries no dependency on one.
 *
 * On a phone it fills the viewport (including the dynamic toolbar, via `100dvh`) so the picture gets
 * the whole screen instead of a floating panel with margins.
 */
export class GalleryLightbox {
    private static open?: GalleryLightbox

    private readonly overlay: HTMLElement
    private gallery?: Gallery
    private readonly onKey: (e: KeyboardEvent) => void
    private readonly previousOverflow: string

    private constructor(title: string) {
        this.overlay = document.createElement('div')
        this.overlay.className = 'rg-gal-lightbox'
        this.overlay.innerHTML = `
            <div class="rg-gal-panel" role="dialog" aria-modal="true" aria-label="${title || 'Media'}">
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
            // panel, or a drag that merely ended over the backdrop, must not.
            if (el === this.overlay) this.close()
        })

        this.onKey = e => { if (e.key === 'Escape') this.close() }
        document.addEventListener('keydown', this.onKey)

        // Stop the page behind from scrolling while the overlay owns the screen.
        this.previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        document.body.appendChild(this.overlay)
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

    close(): void {
        this.gallery?.destroy()
        document.removeEventListener('keydown', this.onKey)
        document.body.style.overflow = this.previousOverflow
        this.overlay.remove()
        if (GalleryLightbox.open === this) GalleryLightbox.open = undefined
    }
}
