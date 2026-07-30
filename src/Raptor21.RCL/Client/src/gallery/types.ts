/**
 * Media gallery types.
 *
 * The gallery is independent of any host dialog: it renders into whatever element it is given, so the
 * same component serves an inline panel and the built-in lightbox.
 */

/** Media kinds a slide can carry. The wire format is the raw number. */
export const ImageType = {
    Default: 0,
    Technical: 1,
    Panorama: 2,
    AmericanTechnical: 3,
    EuropeanTechnical: 4,
    Model: 5,
    Vehicle: 6,
    Brochure: 7,
    Pdf: 8,
} as const

export type ImageTypeValue = (typeof ImageType)[keyof typeof ImageType]

/** One slide. A slide is an image, a 3D model, or the 360° spin — never more than one. */
export interface GalleryItem {
    id: string
    type: ImageTypeValue
    /** Full-size source. For a model slide this is the poster image, not the model. */
    url: string
    thumbUrl?: string
    alt?: string
    /** Present only on a 3D slide; its existence is what makes the slide a model. */
    modelUrl?: string
}

/** The 360° spin, collapsed from every Panorama frame into a single slide. */
export interface SpinItem {
    id: string
    frames: string[]
    alt?: string
    thumbUrl?: string
}

/** One row as the images endpoint returns it. */
export interface ProductImage {
    id: string
    productId: string
    imagePath: string
    imageType: number
    isActive?: boolean
    isDeleted?: boolean
}

export interface GallerySource {
    /** Row-level defaults so the grid's own thumbnail can lead the deck before the fetch resolves. */
    title?: string
    alt?: string
    defaultImage?: string
    rowId?: string
}

export interface GalleryOptions {
    startIndex?: number
    /** Extra lighting environments the host supplies for the 3D viewer. */
    hdriPresets?: import('./hdri').HdriPreset[]
    /** Arrow keys move the deck. Off inside an inline gallery that is not focused. */
    keyboard?: boolean
}

/** Human labels per image type, used for the slide badge. */
export const IMAGE_TYPE_LABEL: Record<number, string> = {
    [ImageType.Default]: 'Image',
    [ImageType.Technical]: 'Technical',
    [ImageType.Panorama]: '360°',
    [ImageType.AmericanTechnical]: 'US Technical',
    [ImageType.EuropeanTechnical]: 'EU Technical',
    [ImageType.Model]: '3D',
    [ImageType.Vehicle]: 'Vehicle',
    [ImageType.Brochure]: 'Brochure',
    [ImageType.Pdf]: 'PDF',
}

/**
 * Sort rank per type. The endpoint does not guarantee row order, so the client imposes one; without it
 * the deck reshuffles itself every time it opens.
 */
const ORDER_RANK: Record<number, number> = {
    [ImageType.Default]: 0,
    [ImageType.Vehicle]: 1,
    [ImageType.Model]: 2,
    [ImageType.Panorama]: 3,
    [ImageType.Technical]: 4,
    [ImageType.AmericanTechnical]: 5,
    [ImageType.EuropeanTechnical]: 6,
    [ImageType.Brochure]: 7,
    [ImageType.Pdf]: 8,
}

const rank = (type: number): number => ORDER_RANK[type] ?? 99

const is3dPath = (path: string): boolean => {
    const lower = path.toLowerCase()
    return lower.endsWith('.glb') || lower.endsWith('.gltf')
}

/**
 * Turns the endpoint's rows into slides:
 *
 * - the row's own image leads the deck, so the picture the user clicked is what they see first;
 * - a `type|path` pair is shown once, however many rows carry it;
 * - every Panorama frame collapses into one spin slide rather than N dead frames;
 * - a `.glb`/`.gltf` row becomes a 3D slide whose poster is the row image, since the model file is not
 *   itself a picture and cannot be a thumbnail.
 *
 * Soft-deleted and inactive rows are dropped and the result is sorted, neither of which the endpoint
 * guarantees.
 */
export function buildSlides(rows: ProductImage[], source: GallerySource): { items: GalleryItem[]; spin?: SpinItem } {
    const items: GalleryItem[] = []
    const seen = new Set<string>()
    const panoramaFrames: string[] = []
    const alt = source.alt ?? source.title ?? 'Product'

    if (source.defaultImage) {
        const key = `${ImageType.Default}|${source.defaultImage}`
        seen.add(key)
        items.push({
            id: `row-default-${source.rowId ?? 'x'}`,
            type: ImageType.Default,
            url: source.defaultImage,
            thumbUrl: source.defaultImage,
            alt,
        })
    }

    const usable = (rows ?? []).filter(r => r?.imagePath && r.isDeleted !== true && r.isActive !== false)

    // A model and a spin need a still picture for their thumbnail and blurred backdrop. The row's own
    // image is first choice, then any ordinary photo from the set.
    const poster = source.defaultImage
        ?? usable.find(r => r.imageType !== ImageType.Model
            && r.imageType !== ImageType.Panorama
            && !is3dPath(r.imagePath))?.imagePath

    for (const row of [...usable].sort((a, b) => rank(a.imageType) - rank(b.imageType))) {
        const key = `${row.imageType}|${row.imagePath}`
        if (seen.has(key)) continue
        seen.add(key)

        if (row.imageType === ImageType.Panorama) {
            panoramaFrames.push(row.imagePath)
            continue
        }

        const model = is3dPath(row.imagePath)
        items.push({
            id: row.id,
            // The wire carries a raw number; anything outside the enum still renders as a plain image.
            type: row.imageType as ImageTypeValue,
            // A model has no picture of its own, so a real photo stands in as its poster.
            url: model ? (poster ?? row.imagePath) : row.imagePath,
            thumbUrl: model ? poster : row.imagePath,
            alt,
            modelUrl: model ? row.imagePath : undefined,
        })
    }

    const spin: SpinItem | undefined = panoramaFrames.length > 1
        ? { id: `spin-${source.rowId ?? 'x'}`, frames: panoramaFrames, alt, thumbUrl: poster ?? panoramaFrames[0] }
        : undefined

    // A single panorama frame cannot be spun; show it as an ordinary picture instead of dropping it.
    if (panoramaFrames.length === 1) {
        items.push({
            id: `pano-${source.rowId ?? 'x'}`,
            type: ImageType.Panorama,
            url: panoramaFrames[0],
            thumbUrl: panoramaFrames[0],
            alt,
        })
    }

    return { items, spin }
}
