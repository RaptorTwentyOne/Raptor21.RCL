/**
 * THE ONE STACK OF OPEN MODAL DIALOGS, and the one way into the top layer.
 *
 * WHY THIS MODULE EXISTS — a measured defect, not a tidy-up.
 * Three surfaces in this library open a native `<dialog>` with `showModal()`: `ModalComponent` (every
 * server-rendered `.rg-modal`, plus the imperative ones `ProgressDialog` and `runtime/confirm.ts`
 * build), `NotifyManager.confirm` (a Promise-answering `.rg-ask-overlay`), and `GalleryLightbox`.
 * Each of them binds a DOCUMENT `keydown` listener for Escape, because focus may legitimately sit on
 * the backdrop or inside a nested widget and only a document listener sees the key in every case.
 *
 * Until this module they kept SEPARATE registers of what was open. `ModalComponent` gated its listener
 * on its own `topModal() !== this`, which knows nothing about a confirm or a lightbox; the other two
 * gated on nothing at all. Measured, Chrome 390x844, the real bundles, one TRUSTED Escape:
 *
 *   · `raptorNotify.confirm` open, then a `data-rg-modal-static` `.rg-modal` opened over it →
 *     `staticModalStillOpen: true` (correct, a static dialog refuses Escape) but `askResult: false`
 *     and the ask overlay REMOVED. The key dismissed the dialog the user could not see, and answered a
 *     Promise the caller was still waiting on, while the dialog on screen ignored it.
 *   · `GalleryLightbox` open, then a `.rg-modal` opened over it → the same Escape closed BOTH, and
 *     `document.body.style.overflow` was left `"hidden"` with nothing on screen to release it.
 *
 * The rule this restores is the one a user assumes: ESCAPE BELONGS TO THE TOP-MOST DIALOG, and only
 * to it. Nothing else can answer for it, which is why the register has to be shared rather than
 * per-component.
 *
 * WHY A STACK AND NOT `document.querySelectorAll('dialog[open]')`.
 * The DOM answers in DOCUMENT order; the top layer is ordered by the order things were SHOWN. The two
 * disagree the moment two dialogs live in different parents — and they do: `ModalComponent`'s dialogs
 * are grouped in `#modal-container` (modal/container.ts) while `NotifyManager` appends its confirm to
 * the end of `<body>`. A confirm opened FIRST and a modal opened over it are `[…#modal-container…,
 * dialog.rg-ask-overlay]` in document order, so a DOM scan names the confirm as the top-most while the
 * modal is the one covering it. Registration order is the only order that matches the UA's.
 *
 * WHY IT IS PUSHED FROM `openDialog` AND NOT FROM EACH COMPONENT'S `mount()`.
 * `ModalComponent` lives in a lazily-imported chunk and `modal/modalSkeleton.ts` deliberately opens the
 * placeholder dialog in the frame the request goes out — long before that chunk resolves. Pushing at
 * mount would therefore record an order that can differ from the order `showModal()` actually ran in.
 * Pairing the push with the `showModal()` call is what keeps this stack and the UA's agreeing.
 */

/** `typeof`, not a bare reference: the identifier does not exist at all on an engine without
 *  `<dialog>`, and `x instanceof Undeclared` throws a ReferenceError rather than answering false. */
const HAS_DIALOG = typeof HTMLDialogElement !== 'undefined'

const stack: HTMLElement[] = []

/**
 * Whether a stack entry is still a dialog the user can see.
 *
 * A safety net for the top of the stack, not the primary bookkeeping — every site pops explicitly. It
 * covers the window between `close()` and the registry's `destroy()` (a MutationObserver callback, i.e.
 * a microtask later) in which a dialog is removed but its owner has not run teardown yet.
 *
 * The `open` test is skipped for a non-`<dialog>` element, which is what an engine without the API
 * produces: there the overlay is a normal-layer box with no `open` state to read, and connectedness is
 * the whole of the answer.
 */
function alive(el: HTMLElement): boolean {
    if (!el.isConnected) return false
    if (HAS_DIALOG && el instanceof HTMLDialogElement) return el.open
    return true
}

/**
 * Fired on `document` the instant a dialog has entered the top layer — once per genuine open.
 *
 * WHY AN EVENT IS NEEDED AT ALL. A modal `<dialog>` ENTERING the top layer is the one transition
 * nothing in the DOM reports. It fires `close` on the way out and nothing at all on the way in; it is
 * not a popover, so no `toggle` is dispatched; and it is not an ancestor of the surfaces it displaces,
 * so an ancestor-scoped listener never sees it either. Meanwhile `showModal()` makes every
 * NON-descendant inert — top-layer elements included — so every floating layer that happens to be open
 * at that instant is turned, silently, into something the user can see and cannot touch.
 *
 * MEASURED (Chrome 150, real bundles, /roles, a grid row's action menu open under `<body>`, then a
 * `.rg-modal` opened over it): the panel still reported `hidden: false`, `checkVisibility(): true`, the
 * same rect `{x: 1576, y: 174, w: 176, h: 78}` and `aria-expanded="true"`, while `elementsFromPoint` at
 * its own centre returned `DIALOG.rg-modal`. In sheet mode the same state also holds a `lockScroll()`
 * that only the panel's own `close()` releases.
 *
 * Dispatched on the document rather than handed to a list of interested parties: the surfaces that care
 * are lazily-loaded components that come and go with the page, and this module must not have to know
 * they exist. `detail.host` is the dialog that claimed the layer; a listener whose element the host
 * CONTAINS must ignore the claim — that dialog owns the surface rather than displacing it.
 */
export const TOP_LAYER_CLAIM_EVENT = 'raptor:top-layer-claim'

/** Records `el` as the newest open dialog. Idempotent, and deliberately does NOT re-order an element
 *  that is already registered — a second `openDialog` on an already-open dialog (mount() re-calling
 *  what the skeleton already did) must not promote it over something opened since. */
export function pushDialog(el: HTMLElement): void {
    if (!stack.includes(el)) stack.push(el)
}

/** Forgets `el`. Safe to call twice, and safe to call for an element that was never registered. */
export function popDialog(el: HTMLElement): void {
    const index = stack.indexOf(el)
    if (index >= 0) stack.splice(index, 1)
}

/** The dialog currently covering everything else, or null when none is open. */
export function topDialog(): HTMLElement | null {
    while (stack.length > 0 && !alive(stack[stack.length - 1])) stack.pop()
    return stack.length > 0 ? stack[stack.length - 1] : null
}

/** The gate every Escape handler in the library asks before acting. */
export function isTopDialog(el: HTMLElement): boolean {
    return topDialog() === el
}

/**
 * Puts `el` in the top layer and registers it.
 *
 * Idempotent on the `showModal()` half: the skeleton opens its placeholder immediately and
 * `ModalComponent.mount()` calls in again for the server-rendered case, where nothing has opened it
 * yet. A non-`<dialog>` element is registered but not shown — a consumer on an engine without
 * `<dialog>` still gets the styled overlay in the normal layer, and still gets correct Escape
 * ordering, which is the half that does not need the API.
 */
export function openDialog(el: HTMLElement): void {
    // Read BEFORE the push, so the announcement below fires once per genuine open rather than once per
    // call: the skeleton path calls this twice for the same element (see the note above `pushDialog`),
    // and a second "something just took the layer" would be a claim nothing actually made.
    const isNewClaim = !stack.includes(el)

    if (HAS_DIALOG && el instanceof HTMLDialogElement && !el.open && el.isConnected) {
        try {
            el.showModal()
        } catch {
            /* already open in another tree, or not yet connected — the caller's fallback styling still
               renders the overlay, and a second call will not double-open it. */
        }
    }
    pushDialog(el)

    // AFTER the push, and after `showModal()`: a listener may ask `topDialog()` or measure the new
    // dialog, and both answers must already be the post-open ones.
    if (isNewClaim) {
        document.dispatchEvent(new CustomEvent<{ host: HTMLElement }>(TOP_LAYER_CLAIM_EVENT, {detail: {host: el}}))
    }
}

/**
 * Takes `el` out of the top layer and off the stack.
 *
 * The native `close()` is not decoration: a `<dialog>` removed while still open leaves `open` set on the
 * detached node, and it is that node the modal skeleton re-uses. It also hands focus back to the
 * invoker, which is why `FocusTrap.shouldRestore()` finds nothing to do after this and does not fight
 * the UA for the same element.
 *
 * NOT for a surface that fades out — `NotifyManager.confirm` keeps its dialog OPEN through the 200ms
 * transition and removes it at the end, because `dialog:not([open]) { display: none }` would otherwise
 * make it vanish in one frame. That one pops without closing.
 */
export function closeDialog(el: HTMLElement): void {
    popDialog(el)
    if (HAS_DIALOG && el instanceof HTMLDialogElement && el.open) el.close()
}
