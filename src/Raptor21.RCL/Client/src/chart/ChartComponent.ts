import type {ApexOptions} from 'apexcharts'
import {RaptorComponent} from '../core/Component'
import {chartNeutrals} from './neutrals'
import {readChartOptions} from './options'
import {applyState} from '../core/state'

export type ChartState = 'loading' | 'empty' | 'error' | null

/**
 * Owns one chart's library instance and its lifecycle.
 *
 * This is not a chart builder: it invents no options vocabulary of its own. The whole options object is
 * authored on the server and arrives as a JSON island the component reads on mount, so the shape stays
 * ApexCharts' own and its documentation applies unchanged.
 *
 * One group of values is filled in, and only as a default the caller can override: the theme neutrals
 * (label and grid colours). Those are resolved from CSS custom properties on every render rather than
 * baked in at serialisation time, because a colour serialised on the server goes stale as soon as the
 * user switches between light and dark.
 *
 * Formatters cannot survive JSON, so they travel as `{"@eval": "..."}` markers and are compiled here.
 * That compilation step requires `unsafe-eval` under a strict Content-Security-Policy.
 *
 * The component handles the charting library import, its readiness guard, the placeholder teardown, the
 * error markup and the destroy call, so a caller does none of them.
 */
export class ChartComponent extends RaptorComponent {
    private chart: { destroy(): void; updateOptions(o: ApexOptions): Promise<unknown> } | null = null
    private canvas: HTMLElement | null = null

    /** Serialises render calls so a burst cannot interleave two instantiations on one element. */
    private queue: Promise<unknown> = Promise.resolve()

    /** Last options drawn, so a theme change can redraw without the caller re-fetching. */
    private lastOptions: ApexOptions | null = null

    mount(): void {
        this.canvas = this.find('[data-rg-chart-canvas]') ?? this.el
        // The instance holds listeners and an SVG the element no longer owns once it is swapped away.
        this.onDestroy(() => this.disposeChart())
        this.watchTheme()

        // A chart whose options were authored on the server draws itself here, with no call site on the
        // page. The registry drives mount on first paint and again on every swap that brings a new
        // element in, so an htmx fragment carrying a fresh chart redraws without being re-triggered.
        // Charts that need a closure over page state use the imperative window.raptorChart API instead;
        // a page may do both.
        const options = readChartOptions(this.el)
        if (options) void this.render(options as ApexOptions)
    }

    /**
     * Redraws when the host switches theme.
     *
     * The charting library resolves its palette once, at construction, so a chart drawn in light mode
     * keeps its light grid lines and tooltip after a switch to dark: the CSS variables around it change
     * but the SVG does not, and nothing else re-measures it.
     *
     * Watches the `.dark` class, the same signal this library's own stylesheets key off.
     */
    private watchTheme(): void {
        let dark = ChartComponent.isDark()

        const observer = new MutationObserver(() => {
            const next = ChartComponent.isDark()
            if (next === dark) return
            dark = next
            if (this.lastOptions) void this.render(this.lastOptions)
        })

        observer.observe(document.documentElement, {attributes: true, attributeFilter: ['class']})
        this.onDestroy(() => observer.disconnect())
    }

    private static isDark(): boolean {
        return document.documentElement.classList.contains('dark')
    }

    /**
     * Draws `options`, replacing any previous chart on this element.
     *
     * The charting library arrives through a dynamic import, so a page with no chart downloads none of
     * it.
     */
    render(options: ApexOptions): Promise<void> {
        this.lastOptions = options

        return this.enqueue(async () => {
            const {default: ApexCharts} = await import('apexcharts')
            if (!this.canvas || !this.el.isConnected) return

            this.disposeChart()
            // Clears whatever the server painted while the data was in flight (skeletons, placeholder).
            this.canvas.innerHTML = ''

            // Reveal before constructing: the library measures its container as it renders, and a
            // container still carrying `hidden` measures 0x0, so the chart would draw at zero size and
            // stay there because nothing re-measures it once shown.
            this.state(null)

            // Each value below is a default, supplied only where the caller left the key empty, so a
            // chart that sets its own keeps it.
            //
            // `theme.mode` drives the library's own defaults for tooltip, legend and grid.
            //
            // `background: transparent` keeps the library's dark mode from painting its own chart
            // background as a slab on top of the host's panel.
            //
            // The neutrals are resolved per render rather than by the caller: this component redraws on
            // a theme change and reuses the options it was given, so a colour baked in by the caller
            // would come back stale. Supplying them as `chart.foreColor` and `grid.borderColor` reaches
            // axis and legend text through the library's own inheritance.
            const neutral = chartNeutrals()

            const themed: ApexOptions = {
                ...options,
                theme: options.theme?.mode
                    ? options.theme
                    : {...options.theme, mode: ChartComponent.isDark() ? 'dark' : 'light'},
                chart: {
                    ...options.chart,
                    background: options.chart?.background ?? 'transparent',
                    foreColor: options.chart?.foreColor ?? neutral.label,
                } as ApexOptions['chart'],
                grid: {
                    ...options.grid,
                    borderColor: options.grid?.borderColor ?? neutral.grid,
                } as ApexOptions['grid'],
            }

            const chart = new ApexCharts(this.canvas, themed)
            this.chart = chart as unknown as typeof this.chart
            await chart.render()
        })
    }

    /** Applies new options to the live chart, or draws it if there is none yet. */
    update(options: ApexOptions): Promise<void> {
        if (!this.chart) return this.render(options)
        return this.enqueue(async () => {
            await this.chart?.updateOptions(options)
            this.state(null)
        })
    }

    /**
     * Shows one of the states the caller's markup declared, or the chart itself when null.
     *
     * The states' content is server-rendered and passed in by the caller, so the wording, the icon and
     * the styling stay with the page. This only decides which one is visible.
     */
    state(next: ChartState): void {
        applyState(this.el, next ?? 'content')
        if (this.canvas && this.canvas !== this.el) this.canvas.hidden = next !== null
    }

    private disposeChart(): void {
        try {
            this.chart?.destroy()
        } catch (error) {
            console.error('[raptor21] chart teardown failed', error)
        }
        this.chart = null
    }

    private enqueue(work: () => Promise<void>): Promise<void> {
        const next = this.queue.then(work, work)
        this.queue = next.catch(() => undefined)
        return next
    }
}
