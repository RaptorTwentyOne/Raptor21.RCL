/* eslint-disable @typescript-eslint/no-explicit-any */

import {modalContainer} from '../modal/container'

interface ConfirmProps {
    title: string;
    text: string;
    confirmText: string;
    cancelText: string;
    danger: boolean;
}

const DEFAULTS: ConfirmProps = {
    title: 'Are you sure?',
    text: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    danger: true,
};

function parseConfirm(raw: unknown): ConfirmProps {
    if (typeof raw !== 'string') return {...DEFAULTS};
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            return {
                ...DEFAULTS,
                ...parsed,
                text: (parsed.text ?? parsed.message ?? DEFAULTS.text) as string,
            } as ConfirmProps;
        } catch {
            /* not JSON — treat as a plain message */
        }
    }
    return {...DEFAULTS, text: raw};
}

function showConfirm(props: ConfirmProps): Promise<boolean> {
    return new Promise(resolve => {
        const wrap = document.createElement('div');
        wrap.className = 'rg-modal';
        wrap.setAttribute('data-rg-component', 'modal');
        wrap.setAttribute('data-rg-modal-static', '');
        wrap.innerHTML =
            '<div class="rg-modal-dialog rg-modal-sm" data-rg-modal-dialog>' +
            '<div class="rg-modal-head"><h2 class="rg-modal-title"></h2></div>' +
            '<div class="rg-modal-body">' +
            '<p class="rg-confirm-text"></p>' +
            '<div class="rg-form-actions">' +
            '<button type="button" class="rg-btn" data-rg-confirm-cancel data-rg-autofocus></button>' +
            '<button type="button" class="rg-btn" data-rg-confirm-ok></button>' +
            '</div></div></div>';

        (wrap.querySelector('.rg-modal-title') as HTMLElement).textContent = props.title;
        (wrap.querySelector('.rg-confirm-text') as HTMLElement).textContent = props.text;

        const cancelBtn = wrap.querySelector('[data-rg-confirm-cancel]') as HTMLButtonElement;
        const okBtn = wrap.querySelector('[data-rg-confirm-ok]') as HTMLButtonElement;
        cancelBtn.textContent = props.cancelText;
        okBtn.textContent = props.confirmText;
        okBtn.classList.add(props.danger ? 'rg-btn-danger' : 'rg-btn-primary');

        let settled = false;
        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            wrap.remove();
            resolve(ok);
        };

        okBtn.addEventListener('click', () => finish(true));
        cancelBtn.addEventListener('click', () => finish(false));

        modalContainer().appendChild(wrap);
    });
}

/**
 * Replaces `window.confirm` for `hx-confirm` with the library's own modal.
 *
 * htmx fires `htmx:confirm` before every request; when the element carries `hx-confirm`,
 * `detail.question` holds the message and `detail.issueRequest(skip)` proceeds. This handler calls
 * `preventDefault()` to suppress the native dialog, shows the modal, and only issues the request once
 * the user confirms. Elements without `hx-confirm` are left untouched.
 *
 * The dialog is built as the same `rg-modal` DOM the server renders, so the modal component mounts it
 * with a focus trap, scroll lock and inert background. It is marked static, so only the explicit buttons
 * dismiss it.
 */
export function installConfirm(): void {
    document.addEventListener('htmx:confirm', (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (!detail?.question) return;

        event.preventDefault();
        void showConfirm(parseConfirm(detail.question)).then(confirmed => {
            if (confirmed) detail.issueRequest(true);
        });
    });
}
