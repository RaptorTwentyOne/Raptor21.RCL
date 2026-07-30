/** Small DOM helpers shared by every component. Dependency-free. */

/** CSS.escape with a fallback for the handful of engines that still lack it. */
export function cssEscape(value: string): string {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')
}

export function closest<T extends Element = HTMLElement>(target: EventTarget | null, selector: string): T | null {
    return target instanceof Element ? (target.closest(selector) as T | null) : null
}

export function qsa<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
    return [...root.querySelectorAll<T>(selector)]
}

/** Reads a JSON-ish value from localStorage, returning the fallback on absence or corruption. */
export function readStore<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key)
        return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
        return fallback
    }
}

export function writeStore(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value))
    } catch {
        /* private mode or quota exceeded — persistence is best-effort */
    }
}
