import { Carousel } from './carousel'
import { Spin360 } from './spin360'
import { ZoomableImage } from './zoom'
import { IMAGE_TYPE_LABEL, ImageType, type GalleryItem, type GalleryOptions, type SpinItem } from './types'
import { HDRI_PRESETS, applyPreset, readPreferred, writePreferred, type HdriPreset } from './hdri'

/**
 * The media viewer itself: a slide deck plus a thumbnail rail, rendered into any element.
 *
 * It knows nothing about dialogs: the lightbox is one caller, an inline panel on a detail page another.
 *
 * The 3D renderer is imported on demand. `model-viewer` is a full WebGL glTF engine and by far the
 * heaviest dependency here, so a deck with no 3D model never downloads it.
 */
export class Gallery {
    private carousel?: Carousel
    private spin?: Spin360
    private readonly zooms = new Map<number, ZoomableImage>()
    private readonly items: GalleryItem[]
    private readonly root: HTMLElement
    private modelLoader?: Promise<void>
    private readonly hdriPresets: HdriPreset[]

    constructor(host: HTMLElement, items: GalleryItem[], spin?: SpinItem, options: GalleryOptions = {}) {
        this.hdriPresets = [...HDRI_PRESETS, ...(options.hdriPresets ?? [])]

        // The spin becomes one slide among the rest rather than a mode of its own.
        this.items = spin
            ? [...items, { id: spin.id, type: ImageType.Panorama, url: spin.frames[0], thumbUrl: spin.thumbUrl, alt: spin.alt }]
            : items

        this.root = document.createElement('div')
        this.root.className = 'rg-gal'
        this.root.innerHTML = this.markup()
        host.replaceChildren(this.root)

        const track = this.root.querySelector('.rg-gal-track') as HTMLElement
        this.carousel = new Carousel(track, {
            onChange: index => this.onSlide(index),
            // A magnified drawing keeps the drag for panning; everything else lets the deck have it.
            canDrag: index => !this.zooms.get(index)?.isZoomed(),
        })

        this.bindChrome()
        if (spin) this.mountSpin(spin)
        this.onSlide(Math.min(options.startIndex ?? 0, this.items.length - 1))
        if ((options.startIndex ?? 0) > 0) this.carousel.goTo(options.startIndex!, false)
    }

    private markup(): string {
        const slides = this.items.map((item, i) => this.slideMarkup(item, i)).join('')
        const thumbs = this.items.map((item, i) => {
            const interactive = !!item.modelUrl || item.type === ImageType.Panorama
            // A 3D or 360 thumbnail has no picture of its own, so the poster is blurred behind the tag
            // rather than leaving an empty square.
            const inner = item.thumbUrl
                ? (interactive
                    ? `<span class="rg-gal-blur" style="background-image:url('${item.thumbUrl}')"></span>`
                    : `<img src="${item.thumbUrl}" alt="" loading="lazy">`)
                : '<span class="rg-gal-thumb-ph"></span>'

            return `<button type="button" class="rg-gal-thumb${interactive ? ' rg-gal-thumb-media' : ''}" data-rg-gal-thumb="${i}" aria-label="${this.label(item)}">
                        ${inner}
                        <span class="rg-gal-thumb-tag">${this.label(item)}</span>
                    </button>`
        }).join('')

        // The dots are the narrow-screen stand-in for the thumbnail rail, which would otherwise cost a
        // large share of the stage on a phone.
        const dots = this.items.map((_, i) =>
            `<button type="button" class="rg-gal-dot" data-rg-gal-dot="${i}" aria-label="Slide ${i + 1}"></button>`).join('')

        return `
            <div class="rg-gal-stage">
                <div class="rg-gal-track" tabindex="0" role="group" aria-label="Product media">${slides}</div>
                <button type="button" class="rg-gal-nav rg-gal-prev" aria-label="Previous"></button>
                <button type="button" class="rg-gal-nav rg-gal-next" aria-label="Next"></button>
                <div class="rg-gal-counter" aria-live="polite"></div>
            </div>
            <div class="rg-gal-dots">${dots}</div>
            <div class="rg-gal-thumbs">${thumbs}</div>`
    }

    private slideMarkup(item: GalleryItem, index: number): string {
        const label = this.label(item)

        // A model slide gets a plain backdrop rather than the blurred poster used on its thumbnail.
        if (item.modelUrl) {
            return `<div class="rg-gal-slide rg-gal-slide-model" data-rg-gal-slide="${index}" data-model="${item.modelUrl}">
                        <div class="rg-gal-model-mount"><div class="rg-gal-loading">Loading 3D…</div></div>
                        <span class="rg-gal-badge rg-gal-badge-strong">${label}</span>
                    </div>`
        }
        if (item.type === ImageType.Panorama) {
            return `<div class="rg-gal-slide rg-gal-slide-spin" data-rg-gal-slide="${index}">
                        <div class="rg-gal-spin-mount"></div>
                        <span class="rg-gal-badge rg-gal-badge-strong">${label}</span>
                    </div>`
        }
        return `<div class="rg-gal-slide" data-rg-gal-slide="${index}">
                    <div class="rg-gal-figure"><img src="${item.url}" alt="${item.alt ?? ''}" loading="${index === 0 ? 'eager' : 'lazy'}" draggable="false"></div>
                    <span class="rg-gal-badge">${label}</span>
                </div>`
    }

    private label(item: GalleryItem): string {
        return IMAGE_TYPE_LABEL[item.type] ?? 'Media'
    }

    private bindChrome(): void {
        this.root.addEventListener('click', event => {
            const el = event.target as HTMLElement
            if (el.closest('.rg-gal-next')) { this.carousel?.next(); return }
            if (el.closest('.rg-gal-prev')) { this.carousel?.prev(); return }
            const thumb = el.closest('[data-rg-gal-thumb]') as HTMLElement | null
            if (thumb) { this.carousel?.goTo(Number(thumb.dataset.rgGalThumb)); return }
            const dot = el.closest('[data-rg-gal-dot]') as HTMLElement | null
            if (dot) this.carousel?.goTo(Number(dot.dataset.rgGalDot))
        })
    }

    private onSlide(index: number): void {
        for (const [i, zoom] of this.zooms) if (i !== index) zoom.reset()

        for (const el of this.root.querySelectorAll('[data-rg-gal-thumb], [data-rg-gal-dot]')) {
            const own = Number((el as HTMLElement).dataset.rgGalThumb ?? (el as HTMLElement).dataset.rgGalDot)
            el.classList.toggle('is-active', own === index)
        }
        const active = this.root.querySelector(`[data-rg-gal-thumb="${index}"]`)
        active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })

        const counter = this.root.querySelector('.rg-gal-counter')
        if (counter) counter.textContent = `${index + 1} / ${this.items.length}`

        this.ensureSlideReady(index)
    }

    /** Interactive slides are built the first time they are reached, not up front. */
    private ensureSlideReady(index: number): void {
        const slide = this.root.querySelector(`[data-rg-gal-slide="${index}"]`) as HTMLElement | null
        if (!slide || slide.dataset.ready === '1') return
        slide.dataset.ready = '1'

        const model = slide.dataset.model
        if (model) { void this.mountModel(slide, model); return }

        const img = slide.querySelector('.rg-gal-figure img') as HTMLImageElement | null
        const figure = slide.querySelector('.rg-gal-figure') as HTMLElement | null
        if (img && figure) this.zooms.set(index, new ZoomableImage(figure, img))
    }

    private mountSpin(item: SpinItem): void {
        const mount = this.root.querySelector('.rg-gal-spin-mount') as HTMLElement | null
        if (mount) this.spin = new Spin360(mount, item)
    }

    /**
     * Loads `model-viewer` once, on first use. It registers a custom element globally, so the import
     * is shared by every 3D slide in the page.
     */
    private async mountModel(slide: HTMLElement, src: string): Promise<void> {
        const mount = slide.querySelector('.rg-gal-model-mount') as HTMLElement | null
        if (!mount) return
        try {
            this.modelLoader ??= import('@google/model-viewer/dist/model-viewer.js').then(() => undefined)
            await this.modelLoader
            mount.innerHTML =
                `<model-viewer src="${src}" camera-controls touch-action="pan-y" shadow-intensity="1" ` +
                `ar ar-modes="webxr scene-viewer quick-look" style="width:100%;height:100%"></model-viewer>`

            const viewer = mount.querySelector('model-viewer')
            if (viewer) this.mountHdriPicker(slide, viewer)
        } catch {
            mount.innerHTML = '<div class="rg-gal-loading">3D preview unavailable</div>'
        }
    }

    /**
     * The lighting picker, docked to the edge of the 3D stage.
     *
     * It sits over the viewer rather than in the gallery chrome, because it only applies while a model is
     * on screen and its effect is judged by looking at that model.
     */
    private mountHdriPicker(slide: HTMLElement, viewer: Element): void {
        if (slide.querySelector('.rg-gal-hdri')) return

        const active = readPreferred(this.hdriPresets)
        applyPreset(viewer, active)

        const picker = document.createElement('div')
        picker.className = 'rg-gal-hdri'
        picker.setAttribute('role', 'group')
        picker.setAttribute('aria-label', 'Lighting')
        picker.innerHTML =
            '<span class="rg-gal-hdri-title">Lighting</span>' +
            this.hdriPresets.map(p =>
                `<button type="button" class="rg-gal-hdri-opt${p.key === active.key ? ' is-active' : ''}" ` +
                `data-hdri="${p.key}" title="${p.label}"><span>${p.label}</span></button>`).join('')

        picker.addEventListener('click', event => {
            const button = (event.target as HTMLElement).closest('[data-hdri]') as HTMLElement | null
            if (!button) return
            const preset = this.hdriPresets.find(p => p.key === button.dataset.hdri)
            if (!preset) return

            applyPreset(viewer, preset)
            writePreferred(preset.key)
            for (const option of picker.querySelectorAll('[data-hdri]')) {
                option.classList.toggle('is-active', option === button)
            }
        })

        slide.appendChild(picker)
    }

    destroy(): void {
        this.carousel?.destroy()
        this.spin?.destroy()
        for (const zoom of this.zooms.values()) zoom.destroy()
        this.zooms.clear()
    }
}
