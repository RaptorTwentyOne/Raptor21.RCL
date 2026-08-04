import {whenMounted} from '../core/registry'
import type {MapData} from './data'
import type {MapComponent, MapState} from './MapComponent'

/**
 * The public map API.
 *
 * Installed eagerly, because a caller can reach for it the moment its own fetch resolves, which is the
 * window in which a lazily-installed API would not exist yet. The mapping library itself still loads
 * lazily, inside the component.
 */

export interface RaptorMapHandle {
    /** Draws the model, replacing any previous map on the element. */
    render(data: MapData): Promise<void>

    /** Redraws with a new model. */
    update(data: MapData): Promise<void>

    /** Shows the caller's server-rendered empty state. */
    empty(): Promise<void>

    /** Shows the caller's server-rendered error state. */
    fail(): Promise<void>

    /** Shows the caller's server-rendered loading state. */
    loading(): Promise<void>
}

declare global {
    interface Window {
        raptorMap?: (target: string | HTMLElement) => RaptorMapHandle
    }
}

function resolve(target: string | HTMLElement): Promise<MapComponent> {
    const el = typeof target === 'string' ? document.getElementById(target) : target
    if (!el) return Promise.reject(new Error(`[raptor21] no map element for "${String(target)}"`))
    return whenMounted<MapComponent>(el)
}

/**
 * A handle for a map element.
 *
 * Every call resolves the element afresh rather than capturing it, so a handle kept across an htmx swap
 * still draws into the current element instead of a detached node. Rejections are logged rather than
 * thrown, so a map that fails to draw does not take down the page logic that asked for it.
 */
function map(target: string | HTMLElement): RaptorMapHandle {
    const on = <T>(work: (component: MapComponent) => Promise<T>): Promise<void> =>
        resolve(target)
            .then(work)
            .then(() => undefined)
            .catch(error => {
                console.error('[raptor21] map call failed', error)
            })

    const toState = (state: MapState) => (): Promise<void> =>
        on(async component => component.state(state))

    return {
        render: data => on(component => component.render(data)),
        update: data => on(component => component.update(data)),
        empty: toState('empty'),
        fail: toState('error'),
        loading: toState('loading'),
    }
}

export function installMapApi(): void {
    window.raptorMap = map
}
