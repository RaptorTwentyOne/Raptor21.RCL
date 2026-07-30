// Ported from Rizzy's rizzy-confirmation.js (https://github.com/JalexSocial/Rizzy, MIT). htmx 4 extension.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Replaces the built-in `window.confirm()` for `hx-confirm`: intercepts `htmx:confirm` and dispatches a
 * `raptor:confirm-dialog` window event so a UI layer can render a custom dialog, then resolves through
 * `detail.issueRequest()` / `detail.dropRequest()`. `hx-confirm` may be a plain message or a JSON props
 * object.
 */
const htmx = (window as any).htmx;

interface ConfirmResult {
    isConfirmed: boolean;
    isDenied: boolean;
    isDismissed: boolean;
    value: unknown;
}

function showConfirm(props: Record<string, unknown> = {}): Promise<ConfirmResult> {
    return new Promise(resolve => {
        const result: ConfirmResult = { isConfirmed: false, isDenied: false, isDismissed: false, value: null };
        const callbacks = {
            confirm: (value?: unknown) => { result.isConfirmed = true; result.value = value ?? null; resolve(result); },
            deny: () => { result.isDenied = true; resolve(result); },
            dismiss: () => { result.isDismissed = true; resolve(result); },
        };
        const defaults = {
            title: 'Proceed?', text: '', showConfirmButton: true, showDenyButton: false,
            showCancelButton: false, confirmButtonText: 'OK', denyButtonText: 'No', dismissButtonText: 'Cancel',
        };
        window.dispatchEvent(new CustomEvent('raptor:confirm-dialog', { detail: { ...defaults, ...props, ...callbacks } }));
    });
}

function parseConfirm(value: unknown): Record<string, unknown> | null {
    if (!value) return null;
    if (typeof value === 'object') return value as Record<string, unknown>;
    if (typeof value !== 'string') return { title: 'Proceed?', text: String(value) };

    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { return JSON.parse(trimmed); } catch { /* fall through */ }
    }
    return { title: 'Proceed?', text: value };
}

if (htmx?.registerExtension) {
    htmx.registerExtension('raptor-confirm', {
        htmx_confirm: (_elt: Element, detail: any) => {
            const confirmValue = detail?.ctx?.confirm;
            if (!confirmValue) return;

            detail.cancelled = true;

            const props = parseConfirm(confirmValue);
            if (!props) {
                detail.issueRequest();
                return false;
            }

            void showConfirm(props).then(result => {
                if (result.isConfirmed) detail.issueRequest();
                else detail.dropRequest();
            });

            return false;
        },
    });
}

export {};
