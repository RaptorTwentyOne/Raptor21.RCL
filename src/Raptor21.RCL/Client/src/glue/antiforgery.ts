// Ported from Rizzy's rizzy-antiforgery.js (https://github.com/JalexSocial/Rizzy, MIT). htmx 4 extension.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Attaches the ASP.NET antiforgery token to non-GET htmx requests, reading it from
 * `htmx.config.antiforgery` (which htmx parses from the `<meta name="htmx-config">` tag the server
 * emits). On a boosted navigation the token is refreshed from the new page's `htmx-config` meta.
 */
const htmx = (window as any).htmx;

if (htmx?.registerExtension) {
    htmx.registerExtension('raptor-antiforgery', {
        htmx_config_request: (_elt: Element, detail: any) => {
            const req = detail?.ctx?.request;
            if (!req) return;

            const method = (req.method || '').toUpperCase();
            if (method === 'GET' || method === 'HEAD') return;

            const antiforgery = htmx.config?.antiforgery;
            const requestToken = antiforgery?.requestToken;
            if (!requestToken) return;

            const { headerName, formFieldName } = antiforgery;
            if (!headerName && !formFieldName) return;

            if (headerName) {
                req.headers ||= {};
                if (typeof req.headers.set === 'function') req.headers.set(headerName, requestToken);
                else req.headers[headerName] = requestToken;
                return;
            }

            if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return;
            const body = req.body;
            if (!body) return;
            if (typeof body.has === 'function' && body.has(formFieldName)) return;
            if (typeof body.append === 'function') body.append(formFieldName, requestToken);
            else if (typeof body.set === 'function') body.set(formFieldName, requestToken);
        },

        htmx_after_swap: (_elt: Element, detail: any) => {
            const ctx = detail?.ctx;
            if (!ctx?.text) return;

            const boosted = !!ctx.sourceElement?._htmx?.boosted || ctx.request?.headers?.['HX-Boosted'] === 'true';
            if (!boosted) return;

            let doc: Document;
            try {
                doc = new DOMParser().parseFromString(ctx.text, 'text/html');
            } catch {
                return;
            }

            const content = doc.querySelector('meta[name="htmx-config"]')?.getAttribute('content');
            if (!content) return;

            try {
                const parsed = JSON.parse(content);
                if (!parsed?.antiforgery) return;
                htmx.config.antiforgery = parsed.antiforgery;
            } catch (e) {
                console.error('[raptor-antiforgery] failed to parse htmx-config JSON:', e);
                return;
            }

            const current = document.querySelector('meta[name="htmx-config"]');
            if (current) {
                current.setAttribute('content', content);
            } else {
                const meta = document.createElement('meta');
                meta.setAttribute('name', 'htmx-config');
                meta.setAttribute('content', content);
                document.head.appendChild(meta);
            }
        },
    });
}

export {};
