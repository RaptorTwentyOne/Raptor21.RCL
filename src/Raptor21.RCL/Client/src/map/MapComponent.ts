import type * as LeafletNamespace from 'leaflet'
// The mapping library's own stylesheet, without which the tile grid stacks instead of tiling. Imported
// from the module that needs it rather than the global sheet, so it rides the same lazy chunk as the
// library: a page with no map downloads neither.
import 'leaflet/dist/leaflet.css'
import {RaptorComponent} from '../core/Component'
import {applyState} from '../core/state'
import {arcPoints, maxWeight, scaleWeight} from './geometry'
import {readMapData, resolveBasemap, type MapData} from './data'

export type MapState = 'loading' | 'empty' | 'error' | null

/** Marker radius in pixels, per role: the floor and how far the heaviest one grows beyond it. */
const MARKER_SIZE = {
    hub: {min: 7, span: 9},
    origin: {min: 3, span: 5},
    point: {min: 4, span: 6},
} as const

/** Arc stroke width in pixels. */
const ARC_WIDTH = {min: 0.8, span: 3.2}

/**
 * Owns one map's library instance and its lifecycle.
 *
 * This is not a mapping toolkit: it invents no vocabulary of its own beyond markers and arcs. The whole
 * model is authored on the server and arrives as a JSON island the component reads on mount, so the
 * consuming page ships no JavaScript.
 *
 * Colours are resolved from CSS custom properties on every render rather than baked in at serialisation
 * time, because a colour serialised on the server goes stale the moment the user switches between light
 * and dark — the same reason the chart component re-resolves its neutrals.
 *
 * The component handles the library import, the container teardown and the destroy call, so a caller
 * does none of them.
 */
export class MapComponent extends RaptorComponent {
    private map: LeafletNamespace.Map | null = null
    private canvas: HTMLElement | null = null

    /** Serialises render calls so a burst cannot interleave two initialisations on one element. */
    private queue: Promise<unknown> = Promise.resolve()

    /** Last model drawn, so a theme change can redraw without the caller re-fetching. */
    private lastData: MapData | null = null

    mount(): void {
        this.canvas = this.find('[data-rg-map-canvas]') ?? this.el
        // The instance holds a library instance and listeners the element no longer owns once swapped away.
        this.onDestroy(() => this.disposeMap())
        this.watchTheme()
        this.watchResize()

        // A map whose model was authored on the server draws itself here, with no call site on the page.
        // The registry drives mount on first paint and again on every swap that brings a new element in,
        // so an htmx fragment carrying a fresh map redraws without being re-triggered.
        const data = readMapData(this.el)
        if (data) void this.render(data)
    }

    /**
     * Redraws when the host switches theme.
     *
     * Marker and arc colours come from CSS custom properties resolved at draw time, and the SVG the
     * library produced does not re-read them when the variables change. Watches the `.dark` class, the
     * same signal this library's own stylesheets key off.
     */
    private watchTheme(): void {
        let dark = MapComponent.isDark()

        const observer = new MutationObserver(() => {
            const next = MapComponent.isDark()
            if (next === dark) return
            dark = next
            if (this.lastData) void this.render(this.lastData)
        })

        observer.observe(document.documentElement, {attributes: true, attributeFilter: ['class']})
        this.onDestroy(() => observer.disconnect())
    }

    /**
     * Re-measures when the element's box changes.
     *
     * The mapping library caches its container size and paints tiles for that size only. A map inside a
     * panel that starts hidden, or one whose column reflows, would otherwise keep the stale size and show
     * grey gaps where tiles were never requested.
     */
    private watchResize(): void {
        if (typeof ResizeObserver === 'undefined') return

        const observer = new ResizeObserver(() => this.map?.invalidateSize())
        observer.observe(this.el)
        this.onDestroy(() => observer.disconnect())
    }

    private static isDark(): boolean {
        return document.documentElement.classList.contains('dark')
    }

    /** A themed colour from the host's CSS custom properties, with a literal fallback. */
    private cssColor(variable: string, fallback: string): string {
        const value = getComputedStyle(this.el).getPropertyValue(variable).trim()
        return value || fallback
    }

    /**
     * Draws `data`, replacing any previous map on this element.
     *
     * The mapping library arrives through a dynamic import, so a page with no map downloads none of it.
     */
    render(data: MapData): Promise<void> {
        this.lastData = data

        return this.enqueue(async () => {
            const L = await import('leaflet')
            if (!this.canvas || !this.el.isConnected) return

            this.disposeMap()
            // Clears whatever the server painted while the data was in flight (skeleton, placeholder), and
            // the container attribute the library leaves behind, which makes it refuse to reinitialise.
            this.canvas.innerHTML = ''

            // Reveal before initialising: the library measures its container as it creates the map, and a
            // container still carrying `hidden` measures 0x0, so the map would initialise at zero size and
            // stay there because nothing re-measures it once shown.
            this.state(null)

            // Theme goes in here so the CARTO presets can follow it; watchTheme() re-renders on a theme
            // flip, which re-resolves the tiles — light dashboard gets Positron, dark gets Dark Matter.
            const basemap = resolveBasemap(data, MapComponent.isDark())

            const map = L.map(this.canvas, {
                zoomControl: data.zoomControl ?? true,
                // A map inside a long page is scrolled past far more often than it is zoomed, so the wheel
                // stays with the page unless the caller asks otherwise.
                scrollWheelZoom: data.scrollWheelZoom ?? false,
                attributionControl: true,
            })
            this.map = map

            L.tileLayer(basemap.url, {attribution: basemap.attribution, maxZoom: 19}).addTo(map)

            const bounds = this.draw(L, map, data)

            // Framing: the data decides where the interesting part of the world is, so fitting it beats a
            // hardcoded centre that goes wrong the moment the data moves. Falls back to the caller's
            // centre, then to a whole-world view, so a map with nothing on it still paints.
            if ((data.fitToData ?? true) && bounds?.isValid()) {
                map.fitBounds(bounds, {padding: [32, 32], maxZoom: 8})
            } else if (typeof data.centerLat === 'number' && typeof data.centerLng === 'number') {
                map.setView([data.centerLat, data.centerLng], data.zoom ?? 4)
            } else {
                map.setView([20, 0], data.zoom ?? 2)
            }

            // The container is often still settling when the map initialises (a panel animating open, a
            // grid column resolving), and the library only requests tiles for the size it measured.
            requestAnimationFrame(() => this.map?.invalidateSize())
        })
    }

    /** Adds the arcs and markers, returning the bounds enclosing everything drawn. */
    private draw(
        L: typeof LeafletNamespace,
        map: LeafletNamespace.Map,
        data: MapData,
    ): LeafletNamespace.LatLngBounds | null {
        const accent = this.cssColor('--rg-map-accent', '#6366f1')
        const muted = this.cssColor('--rg-map-muted', '#94a3b8')
        const points: Array<[number, number]> = []

        // Arcs first so markers sit above them: an endpoint hidden under its own connection reads as a
        // line that stops short of where it goes.
        const arcs = data.arcs ?? []
        const heaviestArc = maxWeight(arcs)

        for (const arc of arcs) {
            const line = arcPoints(arc.fromLat, arc.fromLng, arc.toLat, arc.toLng)
            const weight = scaleWeight(arc.weight, heaviestArc, ARC_WIDTH.min, ARC_WIDTH.span)

            const polyline = L.polyline(line, {
                color: arc.color ?? accent,
                weight,
                opacity: 0.55,
                // Rounded joins keep the sampled Bézier from showing its segment corners at high zoom.
                lineCap: 'round',
                lineJoin: 'round',
                interactive: Boolean(arc.label),
                className: 'rg-map__arc',
            }).addTo(map)

            // Bound as text, never as HTML: a place name is data, and data that arrives as markup would
            // otherwise be parsed as it.
            if (arc.label) polyline.bindTooltip(arc.label, {sticky: true})

            points.push([arc.fromLat, arc.fromLng], [arc.toLat, arc.toLng])
        }

        const markers = data.markers ?? []
        // Hubs and origins are weighted against their own kind, so one large hub does not shrink every
        // origin to the floor.
        const heaviest: Record<string, number> = {
            hub: maxWeight(markers.filter(m => (m.kind ?? 'point') === 'hub')),
            origin: maxWeight(markers.filter(m => (m.kind ?? 'point') === 'origin')),
            point: maxWeight(markers.filter(m => (m.kind ?? 'point') === 'point')),
        }

        for (const marker of markers) {
            const kind = marker.kind ?? 'point'
            const size = MARKER_SIZE[kind] ?? MARKER_SIZE.point
            const radius = scaleWeight(marker.weight, heaviest[kind] ?? 0, size.min, size.span)
            const color = marker.color ?? (kind === 'origin' ? muted : accent)

            const circle = L.circleMarker([marker.lat, marker.lng], {
                radius,
                color,
                weight: kind === 'hub' ? 2 : 1,
                opacity: 0.9,
                fillColor: color,
                fillOpacity: kind === 'origin' ? 0.45 : 0.75,
                className: `rg-map__marker rg-map__marker--${kind}`,
            }).addTo(map)

            if (marker.label) circle.bindTooltip(marker.label, {direction: 'top'})

            points.push([marker.lat, marker.lng])
        }

        return points.length > 0 ? L.latLngBounds(points) : null
    }

    /** Applies a new model, redrawing the map. */
    update(data: MapData): Promise<void> {
        return this.render(data)
    }

    /**
     * Shows one of the states the caller's markup declared, or the map itself when null.
     *
     * The states' content is server-rendered and passed in by the caller, so the wording, the icon and
     * the styling stay with the page. This only decides which one is visible.
     */
    state(next: MapState): void {
        applyState(this.el, next ?? 'content')
        if (this.canvas && this.canvas !== this.el) this.canvas.hidden = next !== null
    }

    private disposeMap(): void {
        try {
            this.map?.remove()
        } catch (error) {
            console.error('[raptor21] map teardown failed', error)
        }
        this.map = null
    }

    private enqueue(work: () => Promise<void>): Promise<void> {
        const next = this.queue.then(work, work)
        this.queue = next.catch(() => undefined)
        return next
    }
}
