/**
 * Arc geometry.
 *
 * A connection is drawn as a quadratic Bézier sampled into a polyline rather than a straight segment.
 * The reason shows up as soon as a map has more than one: every arc into the same hub arrives along the
 * same few pixels and the fan collapses into an unreadable star. A consistent bow separates them, and
 * bowing every arc the same way gives the pair a direction to read along.
 *
 * The curve is computed in raw latitude/longitude space, not on the projected sphere. Over the distances
 * these maps show — a continent, a trade region — the difference is not visible, and the honest
 * alternative (a great-circle interpolation) buys accuracy nothing here reads.
 */

export interface LatLngTuple {
    0: number
    1: number
    length: 2
}

/** How far the curve bows out, as a fraction of the endpoints' separation. */
const CURVATURE = 0.22

/** Samples per arc. Enough that the curve reads as smooth at any zoom a whole-region map uses. */
const SEGMENTS = 48

/**
 * The polyline points approximating the arc from one point to the other.
 *
 * The control point sits perpendicular to the midpoint, offset by a fraction of the span, so the bow
 * scales with the connection's length instead of being a fixed number of degrees that would swamp a
 * short hop and vanish on a long one.
 *
 * Longitudes are not unwrapped across the antimeridian: a connection spanning it bows the long way round
 * the map rather than crossing the edge. Whole-region maps do not hit this; a genuinely global one would
 * need the endpoints normalised first.
 */
export function arcPoints(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
): Array<[number, number]> {
    const deltaLat = toLat - fromLat
    const deltaLng = toLng - fromLng

    const midLat = (fromLat + toLat) / 2
    const midLng = (fromLng + toLng) / 2

    // Perpendicular to the chord, scaled by its length: a longer connection bows proportionally wider.
    const span = Math.sqrt(deltaLat * deltaLat + deltaLng * deltaLng)
    if (span === 0) return [[fromLat, fromLng]]

    const controlLat = midLat + (-deltaLng / span) * span * CURVATURE
    const controlLng = midLng + (deltaLat / span) * span * CURVATURE

    const points: Array<[number, number]> = []
    for (let step = 0; step <= SEGMENTS; step++) {
        const t = step / SEGMENTS
        const inverse = 1 - t

        // Quadratic Bézier: (1-t)²·P0 + 2(1-t)t·C + t²·P1
        const lat = inverse * inverse * fromLat + 2 * inverse * t * controlLat + t * t * toLat
        const lng = inverse * inverse * fromLng + 2 * inverse * t * controlLng + t * t * toLng
        points.push([lat, lng])
    }

    return points
}

/**
 * Maps a value onto a pixel range, relative to the largest value present.
 *
 * Relative rather than absolute because the caller's unit is its own — sessions, tonnes, orders — and a
 * scale that assumed a range would draw every marker at the floor for one dataset and the ceiling for the
 * next. Uses a square-root curve so a single dominant value does not flatten everything else: area, not
 * radius, tracks the weight, which is how a circle is read.
 */
export function scaleWeight(weight: number | undefined, max: number, min: number, span: number): number {
    if (!weight || weight <= 0 || max <= 0) return min
    return min + Math.sqrt(weight / max) * span
}

/** The largest weight in a set, or 0 when none carry one. */
export function maxWeight(items: Array<{weight?: number}>): number {
    let max = 0
    for (const item of items) {
        if (typeof item.weight === 'number' && item.weight > max) max = item.weight
    }
    return max
}
