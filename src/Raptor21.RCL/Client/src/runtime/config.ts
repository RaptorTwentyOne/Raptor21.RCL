/**
 * Server-supplied configuration.
 *
 * The tag-helper component stamps these onto its own <script> tag, which is the only channel that
 * survives a strict CSP: an inline config script would need a nonce, and so would a global. Filenames
 * are content-hashed, so the URLs can only come from the server's manifest — the client cannot
 * construct them.
 */
export interface RaptorConfig {
    /** URL of the vendored htmx bundle, or null when the host opted out. */
    htmxSrc: string | null
    /** 'auto' loads htmx only when absent, 'always' regardless, 'never' not at all. */
    htmxMode: 'auto' | 'always' | 'never'
}

const DEFAULTS: RaptorConfig = { htmxSrc: null, htmxMode: 'auto' }

let cached: RaptorConfig | null = null

export function config(): RaptorConfig {
    if (cached) return cached

    const tag = document.querySelector<HTMLScriptElement>('script[data-raptor21]')
    if (!tag) return (cached = DEFAULTS)

    const mode = tag.dataset.raptorHtmxMode
    cached = {
        htmxSrc: tag.dataset.raptorHtmx || null,
        htmxMode: mode === 'always' || mode === 'never' ? mode : 'auto',
    }
    return cached
}
