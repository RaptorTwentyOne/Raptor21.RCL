import { RaptorComponent } from '../core/Component'
import { Gallery } from './Gallery'
import { GalleryLightbox } from './GalleryLightbox'
import { buildSlides, type GalleryItem, type ProductImage, type SpinItem } from './types'

/**
 * The declarative seam for the gallery: `data-rg-component="gallery"`.
 *
 * Two shapes, so the same component covers both ways a screen wants media.
 *
 * <b>Inline</b> — the element renders the viewer in place, from items the server embedded
 * (`data-rg-gallery-items`) or from a URL it fetches itself (`data-rg-gallery-src`).
 *
 * <b>Trigger</b> — the element is a thumbnail or a button that opens the lightbox on click, carrying the
 * row's id and picture as data attributes.
 *
 * The component is registered behind a lazy import, so a page with no gallery downloads none of this,
 * and the 3D renderer is loaded later still — only by a slide that actually has a model.
 */
export class GalleryComponent extends RaptorComponent {
    private gallery?: Gallery

    mount(): void {
        const src = this.el.dataset.rgGallerySrc
        const trigger = this.el.dataset.rgGalleryOpen

        if (trigger) {
            this.el.classList.add('rg-gal-trigger')
            if (!this.el.hasAttribute('title')) this.el.title = 'Open media'
            this.on('click', event => {
                // Opening media must not also trigger the row behind it.
                event.preventDefault()
                event.stopPropagation()
                void GalleryLightbox.show(trigger, this.source())
            })
            if (!this.el.hasAttribute('tabindex')) this.el.tabIndex = 0
            this.on('keydown', event => {
                const e = event as KeyboardEvent
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                void GalleryLightbox.show(trigger, this.source())
            })
            return
        }

        const embedded = this.el.dataset.rgGalleryItems
        if (embedded) {
            try {
                const parsed = JSON.parse(embedded) as { items: GalleryItem[]; spin?: SpinItem }
                this.render(parsed.items ?? [], parsed.spin)
            } catch {
                this.el.innerHTML = '<div class="rg-gal-empty">Media could not be read.</div>'
            }
            return
        }

        if (src) void this.load(src)
    }

    private source() {
        return {
            title: this.el.dataset.rgGalleryTitle,
            alt: this.el.dataset.rgGalleryAlt ?? this.el.dataset.rgGalleryTitle,
            defaultImage: this.el.dataset.rgGalleryImage,
            rowId: this.el.dataset.rgGalleryId,
        }
    }

    private async load(url: string): Promise<void> {
        this.el.innerHTML = '<div class="rg-gal-loading">Loading…</div>'
        try {
            const response = await fetch(url, {
                method: this.el.dataset.rgGalleryMethod ?? 'POST',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            const rows: ProductImage[] = payload?.data?.data ?? payload?.Data?.Data ?? []
            const { items, spin } = buildSlides(rows, this.source())
            this.render(items, spin)
        } catch {
            this.el.innerHTML = '<div class="rg-gal-empty">Media could not be loaded.</div>'
        }
    }

    private render(items: GalleryItem[], spin?: SpinItem): void {
        if (!items.length && !spin) {
            this.el.innerHTML = '<div class="rg-gal-empty">No media.</div>'
            return
        }
        this.gallery = new Gallery(this.el, items, spin, { keyboard: true })
    }

    override destroy(): void {
        this.gallery?.destroy()
        super.destroy()
    }
}
