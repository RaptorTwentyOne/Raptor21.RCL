/**
 * Lighting environments for the 3D viewer.
 *
 * `model-viewer` lights a model from an image-based environment, and a model's appearance changes
 * substantially with it, so the environment is exposed as a control rather than fixed.
 *
 * The built-in presets use `model-viewer`'s own generated environments (`neutral`, `legacy`) combined
 * with tone mapping and exposure, which keeps the library self-contained: no `.hdr` files ship with it
 * and nothing is fetched from a CDN. An application that owns real HDRIs can add them through
 * `data-rg-gallery-hdri`.
 */
export interface HdriPreset {
    key: string
    label: string
    /** A URL to an equirectangular HDR/JPG, or one of model-viewer's keywords. */
    environment?: string
    /** model-viewer tone mapping: auto | aces | agx | commerce | neutral | reinhard | cineon | linear | none. */
    tone?: string
    exposure?: string
    /** Draw the environment as the background too, rather than only lighting the model. */
    skybox?: boolean
}

export const HDRI_PRESETS: HdriPreset[] = [
    // Product-photography look: the closest to how these parts appear in the catalogue.
    { key: 'studio', label: 'Studio', environment: 'neutral', tone: 'commerce', exposure: '1' },
    // Even, unopinionated light — best for judging the actual colour of a part.
    { key: 'neutral', label: 'Neutral', environment: 'neutral', tone: 'neutral', exposure: '1' },
    // Warmer and softer; shows surface curvature that flat lighting hides.
    { key: 'soft', label: 'Soft', environment: 'legacy', tone: 'aces', exposure: '1.1' },
    // Lifted exposure for dark castings and rubber, which otherwise read as black blobs.
    { key: 'bright', label: 'Bright', environment: 'neutral', tone: 'agx', exposure: '1.4' },
]

const STORAGE_KEY = 'rg-gal-hdri'

/** The last environment the user picked, so the preference survives closing the gallery. */
export function readPreferred(presets: HdriPreset[]): HdriPreset {
    try {
        const saved = window.localStorage?.getItem(STORAGE_KEY)
        const match = presets.find(p => p.key === saved)
        if (match) return match
    } catch { /* storage can be denied; the default is fine */ }
    return presets[0]
}

export function writePreferred(key: string): void {
    try { window.localStorage?.setItem(STORAGE_KEY, key) } catch { /* not worth failing over */ }
}

/** Applies a preset to a `<model-viewer>` element. */
export function applyPreset(viewer: Element, preset: HdriPreset): void {
    if (preset.environment) viewer.setAttribute('environment-image', preset.environment)
    else viewer.removeAttribute('environment-image')

    if (preset.skybox && preset.environment) viewer.setAttribute('skybox-image', preset.environment)
    else viewer.removeAttribute('skybox-image')

    viewer.setAttribute('tone-mapping', preset.tone ?? 'auto')
    viewer.setAttribute('exposure', preset.exposure ?? '1')
}

/**
 * Presets the host added on the trigger element, merged after the built-ins.
 * Shape: `[{"key":"warehouse","label":"Warehouse","environment":"/hdri/warehouse.hdr"}]`
 */
export function parseCustomPresets(raw: string | undefined): HdriPreset[] {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter((p): p is HdriPreset => !!p?.key && !!p?.label)
    } catch {
        return []
    }
}
