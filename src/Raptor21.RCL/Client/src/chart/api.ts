import type {ApexOptions} from 'apexcharts'
import {whenMounted} from '../core/registry'
import type {ChartComponent, ChartState} from './ChartComponent'

/**
 * The public chart API.
 *
 * Installed eagerly, because a caller can reach for it the moment its own fetch resolves, which is the
 * window in which a lazily-installed API would not exist yet. The charting library itself still loads
 * lazily, inside the component.
 */

export interface RaptorChartHandle {
    /** Draws the options, replacing any previous chart on the element. */
    render(options: ApexOptions): Promise<void>

    /** Applies options to the live chart, drawing it if there is none. */
    update(options: ApexOptions): Promise<void>

    /** Shows the caller's server-rendered empty state. */
    empty(): Promise<void>

    /** Shows the caller's server-rendered error state. */
    fail(): Promise<void>

    /** Shows the caller's server-rendered loading state. */
    loading(): Promise<void>
}

declare global {
    interface Window {
        raptorChart?: (target: string | HTMLElement) => RaptorChartHandle
    }
}

function resolve(target: string | HTMLElement): Promise<ChartComponent> {
    const el = typeof target === 'string' ? document.getElementById(target) : target
    if (!el) return Promise.reject(new Error(`[raptor21] no chart element for "${String(target)}"`))
    return whenMounted<ChartComponent>(el)
}

/**
 * A handle for a chart element.
 *
 * Every call resolves the element afresh rather than capturing it, so a handle kept across an htmx swap
 * still draws into the current element instead of a detached node. Rejections are logged rather than
 * thrown, so a chart that fails to draw does not take down the page logic that asked for it.
 */
function chart(target: string | HTMLElement): RaptorChartHandle {
    const on = <T>(work: (component: ChartComponent) => Promise<T>): Promise<void> =>
        resolve(target)
            .then(work)
            .then(() => undefined)
            .catch(error => {
                console.error('[raptor21] chart call failed', error)
            })

    const toState = (state: ChartState) => (): Promise<void> =>
        on(async component => component.state(state))

    return {
        render: options => on(component => component.render(options)),
        update: options => on(component => component.update(options)),
        empty: toState('empty'),
        fail: toState('error'),
        loading: toState('loading'),
    }
}

export function installChartApi(): void {
    window.raptorChart = chart
}
