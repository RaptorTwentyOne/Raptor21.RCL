/**
 * Modal loading skeleton — fills `#modal-host` the instant a GET for a dialog is in flight, then either
 * grafts the real dialog into it or tears it down, depending on what happens before the response lands.
 *
 * A modal opens by htmx GET-ing markup into `#modal-host`, and the registry only mounts ModalComponent
 * once that markup lands, so between the click and the response there is nothing on screen. This listens
 * document-wide for `htmx:beforeRequest` and, for a GET aimed at the host, swaps in a placeholder before
 * the real request resolves.
 *
 * The placeholder is a real `rg-modal` (`data-rg-component="modal"`, not static) rather than a plain
 * `<div>`, so the registry mounts it exactly like a server-rendered dialog and Escape, the backdrop and
 * the × button all work on the skeleton.
 *
 * Two behaviours follow from the skeleton being a live, closeable dialog:
 *
 *  1. Cancellation. If the user dismisses the skeleton before the response arrives, a MutationObserver on
 *     the host notices it leaving the DOM, aborts the in-flight request, and arms a guard on
 *     `htmx:beforeSwap` in case the abort loses the race with a response already on the wire.
 *
 *  2. Grafting. When the response lands for a skeleton still on screen, it is grafted into the open
 *     skeleton element in place — same node, same ModalComponent instance — rather than letting htmx tear
 *     the skeleton down and swap in a fresh dialog. Keeping the element alive avoids the dialog flickering
 *     shut and reopening, replaying its entrance animation and jumping from the skeleton's size to the
 *     real dialog's. That extends to the `.rg-modal-dialog` node inside it, which is the element the
 *     entrance animation and the geometry actually hang off: the response's contents are moved into the
 *     skeleton's dialog node rather than parsed over it, so nothing is newly created for the animation to
 *     replay on. See `graftDialogInPlace`.
 *
 * Only GET is handled. POST requests (save, delete) also target the host, but they replace an
 * already-open dialog with either nothing or a re-rendered form, and no placeholder is wanted over a
 * dialog the user is already looking at.
 */

import {instanceOf} from '../core/registry'
import type {ModalComponent} from './ModalComponent'
import {openModal} from './open'
import {harvest, load, render, store} from '../skeleton/blueprint'

/** The fields this feature reads off an htmx:beforeRequest event. */
interface HtmxRequestDetail {
    readonly target?: EventTarget | null
    readonly requestConfig?: {
        readonly elt?: EventTarget | null
        readonly verb?: string
        readonly path?: string
        readonly target?: EventTarget | string | null
    }
}

/** The fields this feature reads and writes on an htmx:beforeSwap event. */
interface HtmxBeforeSwapDetail {
    target?: EventTarget | null
    shouldSwap?: boolean
    serverResponse?: unknown
    readonly requestConfig?: {
        readonly elt?: EventTarget | null
    }
}

function detailOf<T>(event: Event): T | undefined {
    return (event as CustomEvent<T | undefined>).detail ?? undefined
}

/**
 * The element htmx is about to swap into, or has just failed to.
 *
 * Resolved from several shapes, because `requestConfig.target` can arrive as either the resolved element
 * or the raw selector still awaiting resolution.
 */
function swapTargetOf(event: Event): Element | null {
    const detail = detailOf<HtmxRequestDetail>(event)
    if (!detail) return null

    if (detail.target instanceof Element) return detail.target

    const configTarget = detail.requestConfig?.target
    if (configTarget instanceof Element) return configTarget
    if (typeof configTarget === 'string') return document.querySelector(configTarget)

    return null
}

const HOST_ID = 'modal-host'

/**
 * Cache key a modal's blueprint is stored and loaded under.
 *
 * Namespaced against page blueprints, which share the same storage prefix, because a modal and a page can
 * be opened from the same GET path without meaning the same layout.
 */
function modalBlueprintKey(path: string): string {
    return `modal:${path}`
}

/* ---- Size class -------------------------------------------------------------------------------
 *
 * The size class is geometry: on the wide layout it is the dialog's width (24rem → 64rem), so a
 * skeleton that guesses it wrong resizes sideways the moment the real dialog is grafted in. The
 * skeleton is built before the response exists, so the size has to come from somewhere else.
 *
 * Two sources, tried in order, both optional:
 *
 *  1. `data-rg-modal-size` on the element that made the request. Authoritative, and right on the very
 *     first open — but it has to be declared on every trigger, so it is offered rather than assumed.
 *  2. What the last dialog at this path turned out to be, remembered here. Costs the trigger nothing
 *     and is right from the second open onwards.
 *
 * On the sheet layout the class also picks the skeleton's HEIGHT FLOOR (`$rg-skel-min-*` in
 * styles/modal/_modal.scss), which is a per-class estimate of how tall this kind of dialog runs. That
 * floor is what the remembered height below overrides once there is a measurement to override it with.
 */

const MODAL_SIZES: readonly string[] = ['sm', 'md', 'lg', 'xl', 'full']
const DEFAULT_MODAL_SIZE = 'md'

/** Shares the blueprint store's prefix and version so a schema reset clears both together. */
const SIZE_STORE_PREFIX = 'rg-skel:v1:modal-size:'

function isModalSize(value: string | null | undefined): value is string {
    return value !== null && value !== undefined && MODAL_SIZES.includes(value)
}

/** The size the trigger declared, if it declared a valid one. */
function declaredSize(elt: EventTarget | null | undefined): string | null {
    if (!(elt instanceof Element)) return null
    const declared = elt.getAttribute('data-rg-modal-size')
    return isModalSize(declared) ? declared : null
}

function learnedSize(path: string | undefined): string | null {
    if (!path) return null
    try {
        const stored = localStorage.getItem(SIZE_STORE_PREFIX + path)
        return isModalSize(stored) ? stored : null
    } catch {
        return null
    }
}

/** Reads the size class off a real dialog element and remembers it for this path's next open. */
function rememberSize(path: string | undefined, dialog: Element | null): void {
    if (!path || !dialog) return

    const size = MODAL_SIZES.find(candidate => dialog.classList.contains(`rg-modal-${candidate}`))
    if (!size) return

    try {
        localStorage.setItem(SIZE_STORE_PREFIX + path, size)
    } catch {
        /* storage unavailable — the default size class is used instead */
    }
}

/* ---- Remembered height ------------------------------------------------------------------------
 *
 * The size class narrows the skeleton's height to a per-class estimate; this narrows it to the truth.
 *
 * The sheet's height used to be a constant in CSS, which made the skeleton exact and every small
 * dialog full-screen (see the long note in styles/modal/_modal.scss). Now that the dialog is
 * content-height again, the placeholder has to predict a height it cannot see — so it stops predicting
 * after the first open and starts REMEMBERING: the real dialog is measured once, at the moment its
 * content lands, and that measurement becomes the next open's floor.
 *
 * The value is stored per GET path, alongside the size class and the body blueprint, under the same
 * prefix and version so one schema reset clears all three.
 *
 * It is applied as a `min-height`, not a `height`: the floor is a starting box, and a dialog that comes
 * back taller than last time (a validation summary, a longer list) must still be allowed to be taller.
 * It is written inline, which beats the stylesheet's per-class floor without an `!important` — and it
 * disappears on its own at graft time, because `syncAttributes` makes the live dialog's attributes match
 * the response's and the response carries no `style` of ours.
 *
 * Px, capped at the sheet height. A raw px value learned on one viewport can be wrong on another; the
 * cap is what keeps "wrong" bounded to "no taller than a sheet may be", and the next open on the new
 * viewport re-learns. A ratio-of-viewport would transfer better between devices and worse between
 * dialogs, and dialogs are what actually differ here: most of this content is intrinsically sized
 * (a form with five fields is the same height on every phone), so px is the more faithful record.
 */

/** Shares the blueprint store's prefix and version so a schema reset clears both together. */
const HEIGHT_STORE_PREFIX = 'rg-skel:v1:modal-h:'

/** Anything outside this is a measurement of something that is not a laid-out dialog. */
const MIN_LEARNED_HEIGHT = 80
const MAX_LEARNED_HEIGHT = 5000

/** The cap the inline floor is clamped to — the sheet's own maximum, `$rg-sheet-h`. */
const SHEET_MAX_HEIGHT = '92dvh'

/**
 * The ROUTE a modal path names, with its query string and fragment dropped.
 *
 * Height is a property of the dialog's layout, and the layout belongs to the route: every open of
 * `/modals/customer-quick-actions` renders the same four rows whatever `?customerId=` says. Keying the
 * height per full URL would make it unlearnable for exactly the dialogs that need it most — the ones
 * opened from a grid row, whose URL carries the row's id and is therefore new on every open — and would
 * grow one storage entry per row the user ever touched.
 *
 * Deliberately narrower than `modalBlueprintKey`, which is left keyed per URL: that one caches the
 * dialog's CONTENT shape, and a query string is allowed to change content.
 */
function modalRoute(path: string): string {
    const cut = path.search(/[?#]/)
    return cut === -1 ? path : path.slice(0, cut)
}

function learnedHeight(path: string | undefined): number | null {
    if (!path) return null
    try {
        const stored = Number(localStorage.getItem(HEIGHT_STORE_PREFIX + modalRoute(path)))
        if (!Number.isFinite(stored)) return null
        return stored >= MIN_LEARNED_HEIGHT && stored <= MAX_LEARNED_HEIGHT ? stored : null
    } catch {
        return null
    }
}

/**
 * Measures the dialog now that it holds the response's content, and remembers the result.
 *
 * Called after the graft, when the skeleton class is already gone and the inline floor with it, so the
 * number recorded is the dialog's own content height rather than the floor it was opened at. Reading
 * `offsetHeight` forces a synchronous layout, which is the point — the measurement has to be of the
 * content that just landed — and it happens once per modal open.
 */
function rememberHeight(path: string | undefined, dialog: HTMLElement | null): void {
    if (!path || !dialog) return

    const height = Math.round(dialog.offsetHeight)
    if (height < MIN_LEARNED_HEIGHT || height > MAX_LEARNED_HEIGHT) return

    try {
        localStorage.setItem(HEIGHT_STORE_PREFIX + modalRoute(path), String(height))
    } catch {
        /* storage unavailable — the stylesheet's per-class floor is used instead */
    }
}

function defaultSkeletonBody(): HTMLElement {
    const body = document.createElement('div')
    body.className = 'rg-modal-body'
    for (const width of ['85%', '95%', '60%', '75%']) {
        const line = document.createElement('span')
        line.className = 'rg-skeleton rg-skeleton-line'
        line.style.width = width
        body.appendChild(line)
    }
    return body
}

/**
 * Builds the placeholder dialog painted the instant a modal-opening GET goes out.
 *
 * It is built to the real dialog's geometry, not to its own content's. Three sources, each one
 * narrower than the last: the size class (width on the wide layout, height floor on the sheet), this
 * path's remembered height, and this path's remembered body shape. All three are optional and the
 * placeholder is correct without any of them — it is just less like the dialog it stands in for.
 */
function buildSkeletonEl(path: string | undefined, size: string): HTMLElement {
    // A `<dialog>`, like the real modal it stands in for — the graft below rewrites this element in
    // place rather than replacing it, so the placeholder and the response have to be the same kind of
    // element or the dialog would have to be re-created and its entrance animation replayed.
    const root = document.createElement('dialog')
    root.className = 'rg-modal rg-modal-skeleton'
    root.setAttribute('data-rg-component', 'modal')
    // Not aria-hidden: the registry mounts this as a real dialog (role=dialog, aria-modal) and the focus
    // trap moves focus inside it, which an aria-hidden subtree may not receive. aria-busy says the same
    // thing correctly — content is on its way — and the graft drops it along with the skeleton class.
    root.setAttribute('aria-busy', 'true')

    const dialog = document.createElement('div')
    dialog.className = `rg-modal-dialog rg-modal-${size}`
    dialog.setAttribute('data-rg-modal-dialog', '')

    // The remembered height, if this path has one, replaces the stylesheet's per-class floor. `min()`
    // rather than a bare px value: the number was measured on some earlier viewport and must not be
    // allowed to push the placeholder past what a sheet is permitted to be on this one. A UA without
    // `dvh` rejects the whole declaration through CSSOM and is left with the stylesheet's floor, which
    // carries its own `vh` fallback — the same degradation path the rest of this geometry takes.
    const height = learnedHeight(path)
    if (height !== null) dialog.style.minHeight = `min(${height}px, ${SHEET_MAX_HEIGHT})`

    root.appendChild(dialog)

    const head = document.createElement('div')
    head.className = 'rg-modal-head'
    const title = document.createElement('span')
    title.className = 'rg-skeleton rg-skeleton-line'
    title.style.width = '40%'
    head.appendChild(title)
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'rg-modal-x'
    close.setAttribute('data-rg-modal-close', '')
    close.setAttribute('aria-label', 'Close')
    close.textContent = '×'
    head.appendChild(close)
    dialog.appendChild(head)

    const blueprint = path ? load(modalBlueprintKey(path)) : null
    if (blueprint && blueprint.length > 0) {
        const body = document.createElement('div')
        body.className = 'rg-modal-body'
        body.appendChild(render(blueprint))
        dialog.appendChild(body)
    } else {
        dialog.appendChild(defaultSkeletonBody())
    }

    return root
}

/**
 * True once the skeleton has been swapped in and not yet replaced, marking the host as still holding a
 * placeholder an error handler may clear rather than a real dialog it must leave alone.
 */
function isShowingSkeleton(target: Element): boolean {
    return target.querySelector(':scope > .rg-modal-skeleton') !== null
}

/**
 * Bookkeeping for one in-flight "open a modal" GET, from the moment the skeleton is painted until the
 * response is grafted in, dropped, or fails outright.
 */
interface Pending {
    /**
     * The element htmx made the request from — the trigger, not the host. Used to abort the request and
     * to recognise which response, among possibly several in flight, this is.
     */
    readonly sourceElt: Element
    readonly skeletonEl: HTMLElement
    /**
     * The GET path this dialog was opened from, and the key its blueprint is learned and loaded under.
     * Undefined when htmx does not expose the path, in which case no blueprint is stored or loaded and
     * the request behaves like a first-ever open.
     */
    readonly path: string | undefined
    /** Set once the user has dismissed the skeleton; the response, whenever it arrives, must be dropped. */
    cancelled: boolean
    /** True only while graft() is actively mutating the host, so the close-detection observer below does
     * not mistake the graft's own DOM writes for the user closing the dialog. */
    grafting: boolean
}

let pending: Pending | null = null
let hostObserver: MutationObserver | null = null

function clearPending(): void {
    hostObserver?.disconnect()
    hostObserver = null
    pending = null
}

/**
 * Notices the skeleton being dismissed (Escape, backdrop, ×) while its response is still in flight, and
 * aborts that request so it cannot reopen the dialog the user just closed.
 *
 * `pending` is kept alive rather than cleared. If the abort loses the race against a response already on
 * the wire, htmx fires no abort event and the response proceeds straight to `htmx:beforeSwap`, where
 * `pending.cancelled` is what stops it swapping into the now-empty host. Cleanup happens in that guard,
 * or in `onRequestFailed` once htmx confirms through `sendAbort` that the abort won.
 */
function watchForUserClose(host: Element): void {
    hostObserver = new MutationObserver(() => {
        if (!pending || pending.grafting || pending.cancelled) return
        if (pending.skeletonEl.isConnected) return

        pending.cancelled = true
        window.htmx?.trigger(pending.sourceElt, 'htmx:abort')
    })
    hostObserver.observe(host, {childList: true})
}

function onBeforeRequest(event: Event): void {
    const detail = detailOf<HtmxRequestDetail>(event)
    const verb = detail?.requestConfig?.verb
    if (verb !== 'get') return

    const target = swapTargetOf(event)
    if (!target || target.id !== HOST_ID) return

    // A previous skeleton still open here is about to be wiped by the write below, which happens when two
    // GETs land before either resolves. Its bookkeeping is dropped now so a late response for it cannot be
    // mistaken for this one's.
    clearPending()

    const path = detail?.requestConfig?.path

    // requestConfig.elt is htmx's own record of the triggering element; the bubbled native target is the
    // same element in practice and serves as a fallback. Resolved before the skeleton is built — the
    // trigger is one of the two places the dialog's size class can come from.
    const requestElt = detail?.requestConfig?.elt
    const sourceElt: Element =
        requestElt instanceof Element ? requestElt : event.target instanceof Element ? event.target : target

    const size = declaredSize(requestElt) ?? declaredSize(sourceElt) ?? learnedSize(path) ?? DEFAULT_MODAL_SIZE
    const skeletonEl = buildSkeletonEl(path, size)
    target.replaceChildren(skeletonEl)
    // Opened HERE and not left to ModalComponent: the whole point of the skeleton is that it paints in
    // the frame the request goes out, and the component lives in a lazily-imported chunk. A `<dialog>`
    // that has not been shown is `display: none` (styles/modal/_modal.scss, restated at author
    // specificity), so waiting for the chunk would mean waiting to paint anything at all. `openModal`
    // also records the element focus is leaving, which is what mount() restores on close.
    openModal(skeletonEl)

    pending = {sourceElt, skeletonEl, path, cancelled: false, grafting: false}
    watchForUserClose(target)
}

/**
 * A failed or aborted request leaves nothing to swap in. Also where `pending` is cleared once an abort
 * triggered by the user closing the skeleton is confirmed to have won its race.
 */
function onRequestFailed(event: Event): void {
    const target = swapTargetOf(event)
    if (!target || target.id !== HOST_ID) return
    if (!pending || event.target !== pending.sourceElt) return

    // Clears only a skeleton still owned by this request, so a slow, superseded request's failure cannot
    // blank out a dialog a later request opened in its place.
    if (isShowingSkeleton(target)) target.innerHTML = ''
    clearPending()
}

/**
 * Attributes on the live skeleton root that the response must not be able to erase.
 *
 * `role`, `aria-modal` and `tabindex` are `ModalComponent.mount()`'s and `FocusTrap`'s, and are already
 * correct on the skeleton.
 *
 * `open` IS LOAD-BEARING AND IS NOT DECORATION. It is the `<dialog>`'s live state, written by
 * `showModal()`; the server's markup renders closed and therefore does not carry it, so without this
 * entry the graft's "remove anything the response does not have" pass would strip it mid-flight and
 * take the dialog the user is looking at out of the top layer.
 */
const PRESERVED_ROOT_ATTRS = new Set(['role', 'aria-modal', 'tabindex', 'open'])

function duplicateScript(script: HTMLScriptElement): HTMLScriptElement {
    const clone = document.createElement('script')
    for (const attr of Array.from(script.attributes)) clone.setAttribute(attr.name, attr.value)
    clone.textContent = script.textContent
    clone.async = false
    return clone
}

/**
 * Replaces every `<script>` under `root` with a freshly-created one so it runs.
 *
 * Assigning through innerHTML never executes embedded scripts, and the graft path bypasses htmx's own
 * `swap()`, which is where that normally happens.
 */
function executeScriptsIn(root: ParentNode): void {
    for (const script of Array.from(root.querySelectorAll('script'))) {
        script.replaceWith(duplicateScript(script))
    }
}

/**
 * Makes `live`'s attributes match `incoming`'s, in place: the incoming values are written over, and
 * anything left behind that the incoming element does not carry is removed, except for the names in
 * `preserved`, which belong to whoever set them on the live node.
 */
function syncAttributes(live: HTMLElement, incoming: HTMLElement, preserved?: ReadonlySet<string>): void {
    live.className = incoming.className

    const incomingNames = new Set(Array.from(incoming.attributes, attr => attr.name))
    for (const attr of Array.from(incoming.attributes)) {
        if (attr.name === 'class') continue
        live.setAttribute(attr.name, attr.value)
    }
    for (const attr of Array.from(live.attributes)) {
        if (attr.name === 'class' || preserved?.has(attr.name) || incomingNames.has(attr.name)) continue
        live.removeAttribute(attr.name)
    }
}

/**
 * Moves the response's dialog contents into the skeleton's own `.rg-modal-dialog` node, keeping that
 * node alive, and returns false when the response's shape leaves no safe way to do so.
 *
 * This is the difference between one entrance animation and two. `.rg-modal-dialog` is the animated
 * element — `rg-modal-in` on the wide layout, `rg-sheet-in` below `$rg-sheet-max` — and a CSS animation
 * runs when its element is created. Replacing the root's innerHTML wholesale, as this used to, destroys
 * the skeleton's dialog and parses a fresh one, so the animation played a second time: the sheet the
 * user was already looking at dropped back off the bottom of the screen and slid up again. Writing into
 * the existing node instead leaves no newly-created element for the animation to attach to, so the
 * entrance plays once, when the skeleton first appears. Changing the node's class (`rg-modal-md` →
 * `rg-modal-lg`) does not restart it, because the animation-name is untouched.
 *
 * Falls back to the caller's wholesale replacement when either side has no dialog node, or when the
 * response put anything beside the dialog inside the modal root — content that would be dropped here.
 */
function graftDialogInPlace(skeletonEl: HTMLElement, incomingModal: HTMLElement): boolean {
    const live = skeletonEl.querySelector<HTMLElement>(':scope > [data-rg-modal-dialog]')
    const incoming = incomingModal.querySelector<HTMLElement>(':scope > [data-rg-modal-dialog]')
    if (!live || !incoming) return false

    for (const node of Array.from(incomingModal.childNodes)) {
        if (node === incoming) continue
        if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim()) continue
        if (node.nodeType === Node.COMMENT_NODE) continue
        return false
    }

    // The dialog's own attributes are the size class and anything the markup put on it; nothing on this
    // node belongs to ModalComponent, so none are preserved. `tabindex` is the one FocusTrap adds, and
    // it re-adds it on rebind.
    syncAttributes(live, incoming)

    // Adopts the response's nodes rather than copying markup, so the head (which the real dialog may not
    // have at all) and the body are replaced together in one write.
    live.replaceChildren(...Array.from(incoming.childNodes))
    executeScriptsIn(live)
    return true
}

/**
 * Rewrites the skeleton element in place to look like — and contain — the real dialog, without replacing
 * the element itself.
 *
 * className and every attribute except the ones `ModalComponent.mount()` owns (role, aria-modal,
 * tabindex, already correct on the skeleton) are synced to match the incoming root: this drops
 * `rg-modal-skeleton` and `aria-busy`, picks up `data-rg-modal-static` when the real dialog is static,
 * and picks up `aria-labelledby` when it has a title.
 *
 * The contents then go in through `graftDialogInPlace`, which keeps the animated dialog node alive.
 * Only when the response's shape rules that out does this fall back to replacing the whole subtree,
 * which is correct but replays the entrance animation.
 */
function applyIncomingModal(skeletonEl: HTMLElement, incomingModal: HTMLElement): void {
    syncAttributes(skeletonEl, incomingModal, PRESERVED_ROOT_ATTRS)

    if (graftDialogInPlace(skeletonEl, incomingModal)) return

    skeletonEl.innerHTML = incomingModal.innerHTML
    executeScriptsIn(skeletonEl)
}

/**
 * Appends whatever else the response contained alongside the modal — typically a `<script>` riding along
 * with the dialog markup — to the host, after the modal. Scripts are recreated so they run; everything
 * else is moved over as-is.
 */
function appendSiblings(host: HTMLElement, remaining: DocumentFragment): void {
    for (const node of Array.from(remaining.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim()) continue
        if (node.nodeType === Node.COMMENT_NODE) continue

        if (node instanceof HTMLScriptElement) host.appendChild(duplicateScript(node))
        else host.appendChild(node)
    }
}

/**
 * Grafts a successful response into the still-open skeleton.
 *
 * Returns false, having touched nothing, when the response contains no `.rg-modal` to graft. A handler is
 * free to answer with something else, and that case is left to htmx's own default swap.
 */
function graft(state: Pending, detail: HtmxBeforeSwapDetail): boolean {
    const html = typeof detail.serverResponse === 'string' ? detail.serverResponse : ''

    const template = document.createElement('template')
    template.innerHTML = html

    // Not querySelector(':scope > .rg-modal'): `:scope >` against a template's DocumentFragment does not
    // match in Chromium even when the modal is the sole top-level child. Iterating children avoids it.
    const incomingModal = Array.from(template.content.children).find(
        (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('rg-modal'))
    if (!incomingModal) return false

    state.grafting = true
    // Leaves only the modal's non-dialog siblings, if any, in the fragment.
    incomingModal.remove()

    // Learn this modal's shape and size for its next open: any container the response declared is
    // remembered under this GET path. A dialog that declares none keeps getting the generic placeholder.
    // Read before the graft, which adopts the response's nodes and leaves the source dialog empty.
    if (state.path) {
        store(modalBlueprintKey(state.path), harvest(incomingModal))
        rememberSize(state.path, incomingModal.querySelector('[data-rg-modal-dialog]'))
    }

    applyIncomingModal(state.skeletonEl, incomingModal)

    // AFTER the graft, not before: this measures the live dialog now that it holds the response's
    // content and has lost both the skeleton class and the inline floor that class carried, so what is
    // recorded is the dialog's own height. Before the graft there is nothing to measure — the incoming
    // element was parsed into a detached <template> and has no layout at all.
    if (state.path) {
        rememberHeight(state.path, state.skeletonEl.querySelector<HTMLElement>('[data-rg-modal-dialog]'))
    }

    const host = state.skeletonEl.parentElement
    if (host) {
        appendSiblings(host, template.content)
        // New hx-* attributes arrived with the real markup and stay inert until htmx processes the
        // subtree that owns them.
        window.htmx?.process(host)
    }

    // When the skeleton's ModalComponent has not finished mounting — possible on the first modal open of
    // a page, if the response beats the import — there is no trap to rebind, so the incoming dialog's
    // explicit autofocus target is honoured directly.
    const modal = instanceOf<ModalComponent>(state.skeletonEl)
    if (modal) modal.regraft()
    else state.skeletonEl.querySelector<HTMLElement>('[data-rg-autofocus]')?.focus()

    state.grafting = false
    return true
}

function onBeforeSwap(event: Event): void {
    const target = swapTargetOf(event)
    if (!target || target.id !== HOST_ID) return
    if (!pending) return

    const detail = detailOf<HtmxBeforeSwapDetail>(event)
    if (!detail) return

    if (detail.requestConfig?.elt !== pending.sourceElt) {
        // A response for a request this host is no longer waiting on, superseded by a later GET before it
        // resolved. Dropping it here leaves the later request's own pending state untouched.
        detail.shouldSwap = false
        return
    }

    if (pending.cancelled) {
        // The abort fired on close lost its race with a response already on the wire, and the dismissed
        // dialog's content must not reappear.
        detail.shouldSwap = false
        clearPending()
        return
    }

    if (detail.shouldSwap === false || !pending.skeletonEl.isConnected) {
        // Either htmx already decided not to swap, or the skeleton is gone: nothing to graft into. Stop
        // tracking and let htmx proceed.
        clearPending()
        return
    }

    if (graft(pending, detail)) detail.shouldSwap = false
    clearPending()
}

export function installModalSkeleton(): void {
    document.addEventListener('htmx:beforeRequest', onBeforeRequest)
    document.addEventListener('htmx:beforeSwap', onBeforeSwap)
    document.addEventListener('htmx:responseError', onRequestFailed)
    document.addEventListener('htmx:sendError', onRequestFailed)
    document.addEventListener('htmx:sendAbort', onRequestFailed)
}
