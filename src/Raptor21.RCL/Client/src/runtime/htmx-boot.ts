import { config } from './config'

/**
 * Ensures htmx is present without ever running two of them.
 *
 * The library needs htmx, but a consumer may already ship it, so 'auto' loads this copy only when the
 * global is missing. In 'auto' mode the presence check is deferred until DOMContentLoaded: a consumer
 * bundling its own htmx typically assigns `window.htmx` from a deferred module, and whether that module
 * evaluates before or after this one is a load-order accident — checking too early would inject a
 * second copy alongside it. Every deferred script has run by DOMContentLoaded, so the answer is
 * deterministic there. The copy is loaded as a classic <script> rather than a dynamic import: htmx
 * attaches itself to window and initialises by scanning the DOM whenever it lands, so arriving after
 * this module still wires up the markup already on the page.
 */
export function ensureHtmx(): Promise<void> {
    const { htmxMode } = config()

    if (htmxMode === 'never') return Promise.resolve()
    if (htmxMode === 'auto') {
        return whenDomReady().then(() => {
            if ('htmx' in window) return
            return loadOwnCopy()
        })
    }
    return loadOwnCopy()
}

function whenDomReady(): Promise<void> {
    if (document.readyState !== 'loading') return Promise.resolve()
    return new Promise(resolve =>
        document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
}

function loadOwnCopy(): Promise<void> {
    const { htmxSrc } = config()

    if (!htmxSrc) {
        if (!('htmx' in window)) {
            console.error('[raptor21] htmx is required but is neither present nor configured. ' +
                'Register the library with AddRaptor21() so it can supply its own copy.')
        }
        return Promise.resolve()
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[data-raptor21-htmx]`)
    if (existing) return whenLoaded(existing)

    const tag = document.createElement('script')
    tag.src = htmxSrc
    tag.defer = true
    tag.setAttribute('data-raptor21-htmx', '')
    document.head.appendChild(tag)
    return whenLoaded(tag)
}

function whenLoaded(tag: HTMLScriptElement): Promise<void> {
    if ('htmx' in window) return Promise.resolve()
    return new Promise(resolve => {
        tag.addEventListener('load', () => resolve(), { once: true })
        tag.addEventListener('error', () => {
            console.error('[raptor21] failed to load htmx from', tag.src)
            resolve()
        }, { once: true })
    })
}
