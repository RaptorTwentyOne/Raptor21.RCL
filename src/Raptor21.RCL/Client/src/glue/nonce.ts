// Ported from Rizzy's rizzy-nonce.js (https://github.com/JalexSocial/Rizzy, MIT). htmx 4 extension.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * CSP-nonce handling for htmx swaps: rewrites the response nonce to the document nonce and strips any
 * script/style/link whose nonce does not match, so injected content cannot smuggle in an unexpected one.
 * Only relevant when the host emits a CSP nonce.
 */
const htmx = (window as any).htmx;

function documentNonce(): string {
    return htmx?.config?.documentNonce ?? htmx?.config?.inlineScriptNonce ?? '';
}

function responseNonce(response: any): string {
    const headers = response?.headers?.get ? response.headers : response;
    const fromHeader = headers?.get?.('HX-Nonce') || '';
    if (fromHeader) return fromHeader;

    const csp = headers?.get?.('content-security-policy') || '';
    const match = csp.match(/(style|script)-src[^;]*'nonce-([^']*)'/i);
    return match ? match[2] : '';
}

function processHtml(text: string, docNonce: string, respNonce: string): string {
    if (typeof text !== 'string') return '';
    if (docNonce && respNonce) text = text.replaceAll(respNonce, docNonce);

    try {
        const doc = new DOMParser().parseFromString(text, 'text/html');
        doc.querySelectorAll('script, style, link').forEach(elt => {
            if (elt.getAttribute('nonce') !== docNonce) elt.remove();
        });
        return doc.documentElement.outerHTML;
    } catch {
        return '';
    }
}

if (htmx?.registerExtension) {
    htmx.registerExtension('raptor-nonce', {
        htmx_after_request: (_elt: Element, detail: any) => {
            const ctx = detail?.ctx;
            if (typeof ctx?.text === 'string') {
                ctx.text = processHtml(ctx.text, documentNonce(), responseNonce(ctx.response));
            }
            return true;
        },
    });
}

export {};
