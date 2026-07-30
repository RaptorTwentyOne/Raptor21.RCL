/**
 * Reads a chart's server-authored options off the DOM and makes them usable by the charting library.
 *
 * This is the half that lets a page declare a whole chart on the server and ship no JavaScript of its own.
 * The server serialises its options object; this reads it back and revives the one thing JSON cannot carry.
 *
 * Functions. The library takes callbacks for axis labels, tooltips and data labels, and JSON has no way to
 * express one. The server therefore writes a function as a marked object:
 *
 *     "formatter": { "@eval": "function (value) { return value + ' USD' }" }
 *
 * and this turns that marker back into a real function. The shape matches the one
 * apexcharts/Blazor-ApexCharts uses, so a caller can follow that library's documentation and examples
 * without translating anything.
 *
 * ⚠️ The revival step evaluates code the server produced. A page carrying chart options therefore requires
 * `unsafe-eval` under a strict CSP, and anything that can influence those option strings can run script.
 * The strings must come from the application's own source — never from user input, and never from a
 * database field a user can write. There is no sanitising short of not doing this; hosts that cannot accept
 * it should use the fixed vocabulary of named formats instead.
 */

/** The marker key the server writes around a JavaScript function source string. */
const EVAL_KEY = '@eval'

function isEvalMarker(value: unknown): value is Record<string, string | string[]> {
    return typeof value === 'object' && value !== null && EVAL_KEY in value
}

/**
 * Compiles one function source string.
 *
 * Wrapped in parentheses so a bare `function (…) {}` is parsed as an expression rather than a declaration,
 * and run under strict mode so the compiled function does not inherit sloppy-mode semantics from wherever
 * it happens to be called.
 */
function compile(source: string): unknown {
    try {
        // eslint-disable-next-line no-eval
        return eval(`'use strict'; (${source})`)
    } catch (error) {
        console.error('[raptor21] chart option function failed to compile', {source, error})
        return undefined
    }
}

/**
 * Walks a parsed options object and replaces every `@eval` marker with a live function.
 *
 * Done as a post-parse walk rather than a `JSON.parse` reviver because a reviver visits leaves before their
 * parents and cannot tell the marker object apart until it is already assembled.
 */
export function reviveOptionFunctions<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map(item => reviveOptionFunctions(item)) as unknown as T
    }

    if (isEvalMarker(value)) {
        const source = value[EVAL_KEY]
        // The upstream shape allows a list, for options that accept several callbacks in one key.
        return (Array.isArray(source) ? source.map(compile) : compile(source)) as unknown as T
    }

    if (typeof value === 'object' && value !== null) {
        const out: Record<string, unknown> = {}
        for (const [key, item] of Object.entries(value)) {
            out[key] = reviveOptionFunctions(item)
        }
        return out as unknown as T
    }

    return value
}

/**
 * The options a chart element carries, or null when the page did not author any server-side.
 *
 * The payload lives in a `<script type="application/json">` that is a sibling of the drawing box, never
 * inside it: the first render clears the box's contents, so options placed within would be gone before a
 * redraw — a theme flip, for instance — needed them again.
 */
export function readChartOptions(root: Element): Record<string, unknown> | null {
    const holder = root.querySelector('[data-rg-chart-options]')
    if (!holder?.textContent) return null

    try {
        return reviveOptionFunctions(JSON.parse(holder.textContent) as Record<string, unknown>)
    } catch (error) {
        console.error('[raptor21] chart options could not be parsed', error)
        return null
    }
}
