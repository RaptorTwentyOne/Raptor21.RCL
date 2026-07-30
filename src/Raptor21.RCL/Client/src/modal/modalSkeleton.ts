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
 *     real dialog's.
 *
 * Only GET is handled. POST requests (save, delete) also target the host, but they replace an
 * already-open dialog with either nothing or a re-rendered form, and no placeholder is wanted over a
 * dialog the user is already looking at.
 */

import {instanceOf} from '../core/registry'
import type {ModalComponent} from './ModalComponent'
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
 * When this path's shape was learned from a previous open, the body renders that shape instead of the
 * generic four lines, so a second open shows placeholders matching the dialog's real layout.
 */
function buildSkeletonEl(path: string | undefined): HTMLElement {
    const root = document.createElement('div')
    root.className = 'rg-modal rg-modal-skeleton'
    root.setAttribute('data-rg-component', 'modal')
    root.setAttribute('aria-hidden', 'true')

    const dialog = document.createElement('div')
    dialog.className = 'rg-modal-dialog rg-modal-md'
    dialog.setAttribute('data-rg-modal-dialog', '')
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
    const skeletonEl = buildSkeletonEl(path)
    target.replaceChildren(skeletonEl)

    // requestConfig.elt is htmx's own record of the triggering element; the bubbled native target is the
    // same element in practice and serves as a fallback.
    const requestElt = detail?.requestConfig?.elt
    const sourceElt: Element =
        requestElt instanceof Element ? requestElt : event.target instanceof Element ? event.target : target

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

const PRESERVED_ROOT_ATTRS = new Set(['role', 'aria-modal', 'tabindex'])

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
 * Rewrites the skeleton element in place to look like — and contain — the real dialog, without replacing
 * the element itself.
 *
 * className and every attribute except the ones `ModalComponent.mount()` owns (role, aria-modal,
 * tabindex, already correct on the skeleton) are synced to match the incoming root: this drops
 * `rg-modal-skeleton` and `aria-hidden`, picks up `data-rg-modal-static` when the real dialog is static,
 * and picks up `aria-labelledby` when it has a title. The skeleton's placeholder innerHTML is then
 * replaced with the real dialog's, which corrects the size class.
 */
function applyIncomingModal(skeletonEl: HTMLElement, incomingModal: HTMLElement): void {
    skeletonEl.className = incomingModal.className

    const incomingNames = new Set(Array.from(incomingModal.attributes, attr => attr.name))
    for (const attr of Array.from(incomingModal.attributes)) {
        if (attr.name === 'class') continue
        skeletonEl.setAttribute(attr.name, attr.value)
    }
    for (const attr of Array.from(skeletonEl.attributes)) {
        if (attr.name === 'class' || PRESERVED_ROOT_ATTRS.has(attr.name) || incomingNames.has(attr.name)) continue
        skeletonEl.removeAttribute(attr.name)
    }

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

    applyIncomingModal(state.skeletonEl, incomingModal)

    // Learn this modal's shape for its next open: any container the response declared is remembered under
    // this GET path. A dialog that declares none keeps getting the generic placeholder.
    if (state.path) store(modalBlueprintKey(state.path), harvest(incomingModal))

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
