/**
 * The map's data contract, mirroring Raptor21.RCL.Map.Models on the server.
 *
 * Unlike the chart's options this is data only — coordinates, weights, labels. Nothing here is compiled
 * or evaluated, so a page carrying a map needs no `unsafe-eval` in its Content-Security-Policy. Keep it
 * that way: if this ever needs a callback, pass a named choice the client resolves, not a source string.
 */

export type MapBasemapName = 'cartoPositron' | 'cartoDarkMatter' | 'openStreetMap'
export type MapMarkerKind = 'hub' | 'origin' | 'point'

export interface MapMarkerData {
    id?: string
    lat: number
    lng: number
    label?: string
    kind?: MapMarkerKind
    weight?: number
    color?: string
}

export interface MapArcData {
    fromLat: number
    fromLng: number
    toLat: number
    toLng: number
    weight?: number
    color?: string
    label?: string
}

export interface MapData {
    basemap?: MapBasemapName
    tileUrl?: string
    attribution?: string
    centerLat?: number
    centerLng?: number
    zoom?: number
    fitToData?: boolean
    markers?: MapMarkerData[]
    arcs?: MapArcData[]
    scrollWheelZoom?: boolean
    zoomControl?: boolean
}

/** Tile template and the credit line each provider requires. */
const BASEMAPS: Record<MapBasemapName, {url: string; attribution: string}> = {
    cartoPositron: {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
    cartoDarkMatter: {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
    openStreetMap: {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors',
    },
}

/**
 * The tile layer to draw, from an explicit URL or the named basemap.
 *
 * A caller-supplied `tileUrl` wins and carries its own attribution: pointing at another tile server does
 * not transfer that server's credit obligation to whatever basemap happened to be named alongside it.
 */
export function resolveBasemap(data: MapData, dark = false): {url: string; attribution: string} {
    if (data.tileUrl) {
        return {url: data.tileUrl, attribution: data.attribution ?? ''}
    }

    // The two CARTO presets are one design in two luminances, so they follow the host's theme: a
    // light-grey basemap on a dark dashboard reads as a hole in the page (measured on the analytics
    // screen), and the server that authored the model cannot know which theme the viewer runs. An
    // explicit tileUrl above is the opt-out for a page that really wants one fixed look.
    let name = data.basemap ?? 'cartoPositron'
    if (dark && name === 'cartoPositron') name = 'cartoDarkMatter'
    else if (!dark && name === 'cartoDarkMatter') name = 'cartoPositron'

    const preset = BASEMAPS[name] ?? BASEMAPS.cartoPositron
    return {url: preset.url, attribution: data.attribution ?? preset.attribution}
}

/**
 * The map an element carries, or null when the page did not author one server-side.
 *
 * The payload lives in a `<script type="application/json">` that is a sibling of the drawing box, never
 * inside it: the first render hands the box to the mapping library, which empties it, so a payload placed
 * within would be gone before a redraw needed it again.
 */
export function readMapData(root: Element): MapData | null {
    const holder = root.querySelector('[data-rg-map-data]')
    if (!holder?.textContent) return null

    try {
        return JSON.parse(holder.textContent) as MapData
    } catch (error) {
        console.error('[raptor21] map data could not be parsed', error)
        return null
    }
}
