/**
 * Pure helpers for the editor's document round-trip: what goes INTO the design frame and what comes back OUT
 * of it. Nothing here touches the component, the toolbar or the textarea — only strings and DOM trees — so the
 * serialize path can be reasoned about (and, one day, unit-tested) on its own.
 */

/** The `{identifier}` placeholder grammar the editor chips. Anchored to word-ish identifiers on purpose: a
 *  CSS block `{color:red}` or a JSON snippet in a template must NOT be mistaken for a variable. */
export const TOKEN_PATTERN = /\{[A-Za-z_][A-Za-z0-9_]*\}/g

/** Attribute every chip carries; also the selector the unwrap pass keys on. */
export const TOKEN_ATTR = 'data-rg-token'

/** Attribute on the editor-only `<style>` injected into the frame head — removed again on serialize. */
export const EDITOR_STYLE_ATTR = 'data-rg-editor'

/** Attribute the frame body carries while it has no content, so the placeholder CSS can show. */
export const EMPTY_ATTR = 'data-rg-empty'

/**
 * How the source was shaped when it arrived, so it leaves the same way.
 *
 * The editor's frame always holds a full document (the browser wraps whatever is written in html/head/body),
 * so without remembering the shape a two-line fragment would come back as a whole page — a silent change to
 * the host's data that only shows up when the mail is sent.
 */
export interface SourceShape {
    /** `true` when the source had a doctype or an `<html`/`<head`/`<body` tag; `false` when it was a body fragment. */
    readonly fullDocument: boolean
    /** The ORIGINAL doctype line, verbatim, when there was one — preserved byte for byte on the way out. */
    readonly doctype: string | null
}

const DOCTYPE_RE = /^\s*<!doctype[^>]*>/i
// `<body bgcolor=…>` or `<head>` without `<html>` is still a document, not a fragment: serializing only the body's
// innerHTML would drop the body tag's own attributes (background, margins) that mail templates rely on.
const HTML_TAG_RE = /<(html|head|body)[\s>]/i

export function detectShape(source: string): SourceShape {
    const doctypeMatch = DOCTYPE_RE.exec(source)
    const doctype = doctypeMatch ? doctypeMatch[0].trim() : null
    return {
        fullDocument: doctype !== null || HTML_TAG_RE.test(source),
        doctype,
    }
}

/**
 * Removes anything that could execute, from the STRING, before it is ever parsed in the frame.
 *
 * Defence in depth: the frame is `sandbox="allow-same-origin"` without `allow-scripts`, which already makes
 * every script inert — but the sandbox is a runtime property of one element and this strip is a property of
 * the data path, so a future change to one does not silently rely on the other. `on*` handlers and
 * `javascript:` URLs are left alone HERE on purpose: in a scripts-disabled frame they cannot run, and a template
 * may legitimately carry `onclick` tracking attributes it expects to keep. They are only stripped by the
 * no-sandbox fallback in the component, where the frame itself no longer guarantees anything.
 */
export function stripScripts(html: string): string {
    // A <script> whose type is a data MIME (application/ld+json, application/json, text/plain…) cannot execute
    // and is legitimate mail markup (Gmail/Schema.org actions), so it survives the strip; everything the
    // browser would treat as JavaScript — no type, a JS type, module — goes.
    const dataType = /^\s*<script\b[^>]*\btype\s*=\s*["']?\s*(application\/(ld\+json|json)|text\/(plain|template|x-[\w.-]+))\s*["']?/i
    return html
        .replace(/<script\b[\s\S]*?<\/script\s*>/gi, match => (dataType.test(match) ? match : ''))
        .replace(/<script\b[^>]*\/?>/gi, match => (dataType.test(match) ? match : ''))
}

/**
 * Removes the attributes that could execute when the frame is NOT sandboxed — the fallback path only.
 * Walks the tree rather than regexing the string, because `on*` inside a quoted attribute value or a comment
 * is not an attribute and a regex cannot tell the difference.
 */
export function stripHandlersAndJavascriptUrls(root: Element): void {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    let node: Node | null = walker.currentNode
    while (node) {
        // nodeType, not `instanceof Element`: the tree lives in the FRAME's realm, whose Element is a different
        // constructor from the parent window's, so instanceof is false for every node and nothing gets stripped.
        if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element
            for (const name of [...element.getAttributeNames()]) {
                const lower = name.toLowerCase()
                if (lower.startsWith('on')) {
                    element.removeAttribute(name)
                    continue
                }
                if ((lower === 'href' || lower === 'src' || lower === 'action' || lower === 'formaction')
                    && /^\s*javascript:/i.test(element.getAttribute(name) ?? '')) {
                    element.removeAttribute(name)
                }
            }
        }
        node = walker.nextNode()
    }
}

/** Tag names whose text is never a template variable — CSS, script bodies and raw-text controls. */
const SKIP_PARENTS = new Set(['STYLE', 'SCRIPT', 'TEXTAREA', 'TITLE', 'NOSCRIPT', 'TEMPLATE'])

/**
 * Turns every `{identifier}` inside body TEXT into a non-editable chip.
 *
 * Text nodes only — never attributes, never `<style>` — because that is exactly what a template engine
 * substitutes at send time, and a chip in an attribute would be HTML the engine never expected. Idempotent: a
 * text node that already lives in a chip is skipped, so the pass can run again after every token insert.
 *
 * @param blockTokens tokens the host declared as HTML blocks; they get the block modifier so a whole-row
 *                    placeholder reads as a row, not as a word.
 */
export function wrapTokens(body: HTMLElement, blockTokens: ReadonlySet<string>): void {
    const doc = body.ownerDocument
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode(node: Node): number {
            const parent = node.parentElement
            if (!parent) return NodeFilter.FILTER_REJECT
            if (SKIP_PARENTS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
            if (parent.closest(`[${TOKEN_ATTR}]`)) return NodeFilter.FILTER_REJECT
            TOKEN_PATTERN.lastIndex = 0
            return TOKEN_PATTERN.test(node.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
        },
    })

    // Collect first, mutate after: splitting a text node while the walker stands on it is undefined territory.
    const targets: Text[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n as Text)

    // A collapsed caret inside a node about to be replaced must be put back by hand: a live range whose
    // container is removed collapses to (parent, index) — i.e. BEFORE everything inserted there — so after
    // "insert {token}" the caret would jump to the start of the run and typing would continue in front of it.
    const selection = doc.getSelection()
    const live = selection && selection.rangeCount > 0 && selection.isCollapsed ? selection.getRangeAt(0) : null
    const caret = live && live.startContainer.nodeType === Node.TEXT_NODE
        ? {text: live.startContainer as Text, offset: live.startOffset}
        : null

    for (const text of targets) {
        const value = text.nodeValue ?? ''
        const fragment = doc.createDocumentFragment()
        let restore: {node: Node; offset: number} | {after: Node} | null = null
        const place = (piece: Node, start: number, length: number, chip: boolean): void => {
            if (restore || !caret || caret.text !== text || caret.offset > start + length) return
            if (chip ? caret.offset <= start : caret.offset < start) return
            restore = chip ? {after: piece} : {node: piece, offset: caret.offset - start}
        }
        let last = 0
        TOKEN_PATTERN.lastIndex = 0
        for (let m = TOKEN_PATTERN.exec(value); m; m = TOKEN_PATTERN.exec(value)) {
            if (m.index > last) place(fragment.appendChild(doc.createTextNode(value.slice(last, m.index))), last, m.index - last, false)
            place(fragment.appendChild(createChip(doc, m[0], blockTokens.has(m[0]))), m.index, m[0].length, true)
            last = m.index + m[0].length
        }
        if (last < value.length) place(fragment.appendChild(doc.createTextNode(value.slice(last))), last, value.length - last, false)
        text.replaceWith(fragment)
        if (restore && selection) {
            const range = doc.createRange()
            if ('after' in restore) range.setStartAfter((restore as {after: Node}).after)
            else range.setStart((restore as {node: Node; offset: number}).node, (restore as {node: Node; offset: number}).offset)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
        }
    }
}

function createChip(doc: Document, token: string, block: boolean): HTMLSpanElement {
    const chip = doc.createElement('span')
    chip.className = block ? 'rg-editor-token rg-editor-token--block' : 'rg-editor-token'
    chip.setAttribute(TOKEN_ATTR, '')
    // Non-editable so a caret can never land INSIDE the braces and split `{fullName}` into two half-tokens the
    // engine no longer recognises. The chip is deleted as one unit, which is the behaviour an author expects.
    chip.setAttribute('contenteditable', 'false')
    chip.textContent = token
    return chip
}

/** The inverse of `wrapTokens`, run on a CLONE: chips become the plain text they wrap. */
export function unwrapTokens(root: ParentNode): void {
    for (const chip of [...root.querySelectorAll(`[${TOKEN_ATTR}]`)]) {
        chip.replaceWith(chip.ownerDocument.createTextNode(chip.textContent ?? ''))
    }
}

/**
 * The document as the host should receive it: editor-only additions removed, tokens plain, original shape.
 *
 * Works on a deep clone so the live frame keeps its chips and styles — serialize runs on every input event and
 * must never disturb what the author is looking at.
 */
export function serialize(doc: Document, shape: SourceShape): string {
    const root = doc.documentElement.cloneNode(true) as HTMLElement

    root.querySelector(`style[${EDITOR_STYLE_ATTR}]`)?.remove()
    unwrapTokens(root)

    // Only what the editor itself added comes off. Editing runs through `designMode`, which marks nothing on
    // the body, so an author's own `contenteditable`/`spellcheck` (unlikely, but theirs) is left untouched.
    const body = root.querySelector('body')
    body?.removeAttribute(EMPTY_ATTR)

    if (!shape.fullDocument) {
        // A fragment is never parsed as "just a body": the parser hoists a leading <style>/<meta>/<link>/<title>
        // into <head> and parks comments outside head/body on <html>. All of it is the author's, so it comes back
        // in document order — head content first, then the body, then trailing comments.
        let out = ''
        for (const node of [...root.childNodes]) {
            if (node.nodeName === 'HEAD' || node.nodeName === 'BODY') out += (node as HTMLElement).innerHTML
            else if (node.nodeType === Node.COMMENT_NODE) out += `<!--${node.nodeValue ?? ''}-->`
        }
        return out
    }

    // The original doctype line when the source began with one; otherwise the parsed one (a doctype preceded by
    // a comment is still a doctype); `<!DOCTYPE html>` only when there was none at all.
    const doctype = shape.doctype ?? (doc.doctype ? doctypeOf(doc.doctype) : '<!DOCTYPE html>')
    // Comments at document level (before or after <html>) are outside documentElement.outerHTML and would vanish.
    let before = ''
    let after = ''
    let seenRoot = false
    for (const node of [...doc.childNodes]) {
        if (node === doc.documentElement) seenRoot = true
        else if (node.nodeType === Node.COMMENT_NODE) {
            const comment = `<!--${node.nodeValue ?? ''}-->\n`
            if (seenRoot) after += comment
            else before += comment
        }
    }
    return `${doctype}\n${before}${root.outerHTML}${after ? '\n' + after.trimEnd() : ''}`
}

function doctypeOf(dt: DocumentType): string {
    const publicId = dt.publicId ? ` PUBLIC "${dt.publicId}"` : ''
    const systemId = dt.systemId ? `${dt.publicId ? '' : ' SYSTEM'} "${dt.systemId}"` : ''
    return `<!DOCTYPE ${dt.name}${publicId}${systemId}>`
}

/** Whether the body has anything an author would consider content — used to show or hide the placeholder. */
export function bodyIsEmpty(body: HTMLElement): boolean {
    if (body.querySelector('img, table, hr, iframe, video, audio, svg, [data-rg-token]')) return false
    return (body.textContent ?? '').trim().length === 0
}
