import {RaptorComponent} from '../core/Component'
import {
    EDITOR_STYLE_ATTR,
    EMPTY_ATTR,
    bodyIsEmpty,
    detectShape,
    doctypeShell,
    parseDocument,
    removeExecutableScripts,
    serialize,
    stripHandlersAndJavascriptUrls,
    wrapTokens,
    type SourceShape,
} from './document'
import {openPopover, type PopoverResult} from './Popover'

type EditorMode = 'design' | 'source'

/** The toolbar commands the server markup may declare on a `data-rg-editor-cmd` control. */
type Command =
    | 'bold' | 'italic' | 'underline'
    | 'ul' | 'ol'
    | 'heading'
    | 'link' | 'unlink' | 'image' | 'table'
    | 'token'

/** The `parameters` bag htmx 2 hands to `htmx:configRequest` — a FormData behind a proxy. Only what is used. */
interface HtmxParameters {
    has(name: string): boolean
    set(name: string, value: string): void
}

interface HtmxConfigRequestDetail {
    parameters?: HtmxParameters
}

/**
 * URL schemes the link/image popover refuses. Not an allowlist: an href is often a token ({unsubscribeUrl}) or
 * a mailto:, and the editing frame and the host preview are sandboxed anyway — this only keeps the obviously
 * script-capable schemes out of the stored template.
 */
const UNSAFE_URL = /^\s*(javascript|vbscript|data)\s*:/i

/** Debounce for the "serialize while typing" path, in ms. Short enough that a swap mid-sentence loses nothing
 *  noticeable, long enough that a fast typist does not clone the document per keystroke. */
const SERIALIZE_DEBOUNCE_MS = 300

/** Data attribute a host (or the editor's own Variables menu) puts on any button to insert a token. */
const INSERT_ATTR = 'data-rg-editor-insert'
/** Companion attribute naming the target editor — its textarea id, textarea name or root id. */
const FOR_ATTR = 'data-rg-editor-for'

/**
 * The HTML mail-template editor behind `<RaptorEditor>`.
 *
 * One textarea is the form field and the single source of truth for the host; one sandboxed iframe is the
 * design view. Every edit in the frame is serialized back into the textarea — on input (debounced), after every
 * command, on focus-out, and just before the enclosing form submits or htmx configures a request — so the host
 * posts the document without knowing the editor exists.
 *
 * Why an iframe and not a contenteditable div: the document is a WHOLE page with its own `<head><style>`. A div
 * would either lose the head or leak the template's CSS into the back office; a frame keeps both intact and
 * gives the template its own (light) rendering context under the host's dark theme.
 *
 * Why `sandbox="allow-same-origin"` without `allow-scripts`: measured in Chromium 1xx — with that attribute,
 * `document.open/write/close`, `designMode = 'on'`, `execCommand` (bold, formatBlock, createLink, insertHTML,
 * insertText) and `queryCommandState` all work from the parent, while a `<script>` written into the frame does
 * not run. Editing is a user-agent feature governed by the editing host, not by the frame's scripting flag, and
 * Gecko/WebKit implement the same sandboxing spec — so the same holds there. Should an engine ever refuse,
 * `loadDesign` notices (`designMode` stays `off`), rebuilds the frame without the sandbox, strips inline handlers
 * and `javascript:` URLs in compensation, and says so in the console. No silent degradation either way.
 *
 * Markup contract: see RaptorEditor.razor. Everything the component looks for is a `data-rg-editor-*` attribute.
 */
export class EditorComponent extends RaptorComponent {
    private frame!: HTMLIFrameElement
    private source!: HTMLTextAreaElement
    private headingSelect: HTMLSelectElement | null = null
    private statusMode: HTMLElement | null = null
    private statusChars: HTMLElement | null = null

    private mode: EditorMode = 'design'
    private disabled = false
    private shape: SourceShape = {fullDocument: true, doctype: null}
    private blockTokens: ReadonlySet<string> = new Set()
    private placeholder = ''

    /** The frame document as of the last write — compared against `contentDocument` to detect a replaced doc. */
    private doc: Document | null = null
    /** Listeners on the frame's document/window; torn down before every write, because `document.open()` drops
     *  them on its side and we must not hold a dangling half. */
    private frameBindings: Array<() => void> = []
    /** The last selection seen inside the frame, so a toolbar action that moved focus (a select, a popover, an
     *  insert button elsewhere on the page) can put the caret back where the author left it. */
    private savedRange: Range | null = null
    /** Whether the current frame still carries the sandbox — cleared only by the fallback path. */
    private sandboxed = true
    /** Whether the frame document was edited since it was last written from the textarea. While it was not, the
     *  textarea still holds the author's bytes and serialize must leave them alone: a re-serialization of an
     *  UNTOUCHED document is not a no-op (`<br/>` → `<br>`, entities decoded, attributes re-quoted, tag case…)
     *  and would rewrite every template that was merely opened and saved or previewed. */
    private dirty = false

    private debounceTimer: number | null = null
    private stateFrame: number | null = null
    private popover: {close: () => void} | null = null
    private lastValue = ''

    mount(): void {
        const frame = this.find<HTMLIFrameElement>('.rg-editor__frame')
        const source = this.find<HTMLTextAreaElement>('.rg-editor__source')
        const toolbar = this.find<HTMLElement>('.rg-editor__toolbar')
        if (!frame || !source || !toolbar) {
            console.warn('[raptor21] editor needs .rg-editor__frame, .rg-editor__source and .rg-editor__toolbar')
            return
        }
        this.frame = frame
        this.source = source
        this.headingSelect = this.find<HTMLSelectElement>('select[data-rg-editor-cmd="heading"]')
        this.statusMode = this.find<HTMLElement>('[data-rg-editor-status-mode]')
        this.statusChars = this.find<HTMLElement>('[data-rg-editor-status-chars]')

        this.disabled = this.el.hasAttribute('data-rg-editor-disabled')
        this.mode = this.el.getAttribute('data-rg-editor-mode') === 'source' ? 'source' : 'design'
        this.placeholder = this.el.getAttribute('data-rg-editor-placeholder') ?? ''
        this.blockTokens = new Set((this.el.getAttribute('data-rg-editor-block-tokens') ?? '').split(/\s+/).filter(Boolean))
        this.lastValue = source.value

        // Toolbar buttons must not take focus: a mousedown on a parent-document button would blur the frame and,
        // on some engines, collapse its selection before the click handler runs. `preventDefault` on mousedown
        // keeps focus in the frame; the click still fires. The <select> is exempt — preventing its mousedown
        // stops it from opening — and its own change handler restores the saved range instead.
        this.bind(toolbar, 'mousedown', event => {
            const target = event.target
            if (target instanceof Element && target.closest('button')) event.preventDefault()
        })
        this.bind(toolbar, 'click', event => this.onToolbarClick(event as MouseEvent))
        if (this.headingSelect) {
            this.bind(this.headingSelect, 'change', () => {
                const level = this.headingSelect?.value
                if (level) this.runCommand('heading', level)
            })
        }

        // Source view: typing there is already "serialized" — the textarea is the value — but the status line
        // and the change event still have to follow.
        this.bind(source, 'input', () => this.afterSourceEdit())

        // The form hooks. `submit` for a plain post, `htmx:configRequest` for an htmx one — the latter fires
        // AFTER htmx has collected the form's values, so updating the textarea alone would be too late; the
        // parameters bag itself is patched. Both bubble to the form from wherever they originate.
        const form = this.el.closest('form')
        if (form) this.bind(form, 'submit', () => this.serializeNow())
        // Document level, not the form: a host button OUTSIDE the form that pulls the field in with hx-include
        // (a page-header Save/Publish) fires configRequest from itself, so a form-scoped listener never sees it.
        // Patching only when the bag already carries our field keeps unrelated requests untouched.
        this.onDocument('htmx:configRequest', event => {
            const detail = (event as CustomEvent<HtmxConfigRequestDetail>).detail
            const parameters = detail?.parameters
            const name = this.source.name
            if (!parameters || typeof parameters.has !== 'function' || !name || !parameters.has(name)) return
            this.serializeNow()
            parameters.set(name, this.source.value)
        })

        // The zero-host-JS insert hook: any element anywhere in the document that names this editor.
        this.onDocument('click', event => this.onDocumentClick(event as MouseEvent))

        // Defensive re-load: should the frame's document be replaced behind our back (an engine that navigates
        // the initial about:blank asynchronously), the one we wrote to is gone and the view would be blank.
        this.bind(frame, 'load', () => {
            if (this.mode === 'design' && this.doc && frame.contentDocument !== this.doc) this.loadDesign()
        })

        this.onDestroy(() => {
            this.cancelDebounce()
            if (this.stateFrame !== null) cancelAnimationFrame(this.stateFrame)
            this.popover?.close()
            this.disposeFrameBindings()
        })

        this.applyModeToMarkup()
        if (this.mode === 'design') this.loadDesign()
        else this.updateStatus()
    }

    // ----------------------------------------------------------------------------------------------
    // Design view: writing the document into the frame
    // ----------------------------------------------------------------------------------------------

    /** Writes the textarea's current value into the frame and prepares it for editing. */
    private loadDesign(): void {
        this.popover?.close()
        this.disposeFrameBindings()
        this.savedRange = null

        const html = this.source.value
        this.shape = detectShape(html)
        this.dirty = false

        const doc = this.writeInto(this.frame, html)
        if (!doc) return

        if (!this.disabled) {
            doc.designMode = 'on'
            if (doc.designMode !== 'on' && this.sandboxed) {
                // The engine refused to edit a sandboxed document. Trade the sandbox for a stricter sanitize —
                // and say so, because a reader of the DOM should be able to see which guarantee is in force.
                console.warn('[raptor21] editor: designMode unavailable in the sandboxed frame; rebuilding it without sandbox and stripping inline handlers')
                this.sandboxed = false
                this.el.setAttribute('data-rg-editor-sandbox', 'off')
                this.rebuildFrameWithoutSandbox()
                this.loadDesign()
                return
            }
        }

        this.doc = doc
        this.injectEditorStyle(doc)
        wrapTokens(doc.body, this.blockTokens)
        this.refreshEmptyMarker(doc)
        this.bindFrame(doc)
        this.updateStatus()
        this.scheduleToolbarState()
    }

    /**
     * The source is parsed in an inert `DOMParser` document, scrubbed THERE, and then imported into the frame
     * node by node. The frame never parses author markup: the only thing ever written into it is the doctype
     * shell, built from the parsed doctype's fields. So nothing can execute during parsing (there is nothing to
     * execute in a DOMParser document), nothing survives into the frame that the scrub did not see, and a
     * mutation-XSS payload has no second parse to mutate on. Scripts imported this way are also "already
     * started" by spec, so even a data script that is kept could never run.
     *
     * `open/write/close` for the shell rather than `srcdoc`: the document is rewritten on every mode switch,
     * `srcdoc` would re-navigate (asynchronously, with a load event to wait for) and — decisive — a `srcdoc`
     * frame under this sandbox would re-evaluate its origin per navigation, where the initial about:blank simply
     * inherits ours. The shell has to carry the doctype because quirks/standards mode is fixed at parse time.
     */
    private writeInto(frame: HTMLIFrameElement, html: string): Document | null {
        const doc = frame.contentDocument
        if (!doc) {
            console.warn('[raptor21] editor: frame document is not accessible')
            return null
        }

        const parsed = parseDocument(html)
        removeExecutableScripts(parsed)
        if (!this.sandboxed) {
            // Without the sandbox the frame itself guarantees nothing, so the tree is scrubbed of what could run:
            // inline handlers, javascript: URLs, and nested browsing contexts that would each run their own.
            stripHandlersAndJavascriptUrls(parsed.documentElement)
            for (const nested of [...parsed.querySelectorAll('iframe, frame, object, embed')]) nested.remove()
        }

        doc.open()
        doc.write(doctypeShell(parsed))
        doc.close()

        // Document-level comments (before/after <html>) are part of the author's source and `serialize` puts
        // them back, so they travel too; the parser's implicit html/head/body is swapped for the author's tree.
        for (const node of [...doc.childNodes]) {
            if (node.nodeType === Node.COMMENT_NODE) node.remove()
        }
        const root = doc.importNode(parsed.documentElement, true)
        doc.replaceChild(root, doc.documentElement)
        let seenRoot = false
        for (const node of [...parsed.childNodes]) {
            if (node === parsed.documentElement) seenRoot = true
            else if (node.nodeType === Node.COMMENT_NODE) {
                const comment = doc.importNode(node, true)
                if (seenRoot) doc.appendChild(comment)
                else doc.insertBefore(comment, root)
            }
        }
        return doc
    }

    /** Replaces the frame element: sandbox flags are fixed at document creation, so a new browsing context is
     *  the only way to drop them. The new initial about:blank is same-origin and synchronously writable. */
    private rebuildFrameWithoutSandbox(): void {
        const next = document.createElement('iframe')
        next.className = this.frame.className
        next.title = this.frame.title
        next.referrerPolicy = this.frame.referrerPolicy
        next.hidden = this.frame.hidden
        this.frame.replaceWith(next)
        this.frame = next
        this.bind(next, 'load', () => {
            if (this.mode === 'design' && this.doc && next.contentDocument !== this.doc) this.loadDesign()
        })
    }

    /** Editor-only rules, inside the frame, removed again on serialize: chip look, placeholder, a body that
     *  fills the frame so a click below short content still lands in the editable area. */
    private injectEditorStyle(doc: Document): void {
        doc.querySelector(`style[${EDITOR_STYLE_ATTR}]`)?.remove()
        const style = doc.createElement('style')
        style.setAttribute(EDITOR_STYLE_ATTR, '')
        const placeholder = this.placeholder
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/[\r\n]+/g, ' ')
        style.textContent = `
html, body { min-height: 100%; }
body { box-sizing: border-box; cursor: text; }
body[${EMPTY_ATTR}]::before { content: "${placeholder}"; color: #9aa0a6; pointer-events: none; }
.rg-editor-token {
  display: inline-block; padding: 0 .3em; border-radius: .3em; margin: 0 .05em;
  background: rgba(33,150,243,.12); border: 1px solid rgba(33,150,243,.45); color: #0b63c4;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; line-height: 1.5;
  white-space: nowrap; cursor: default; user-select: all; -webkit-user-select: all;
}
.rg-editor-token--block {
  display: block; padding: .5em .75em; margin: .35em 0; text-align: center; white-space: normal;
  background: rgba(33,150,243,.06); border: 1px dashed rgba(33,150,243,.6);
}
`
        const head = doc.head ?? doc.documentElement.insertBefore(doc.createElement('head'), doc.body)
        head.appendChild(style)
    }

    private bindFrame(doc: Document): void {
        const win = doc.defaultView
        const add = (target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions): void => {
            target.addEventListener(type, handler, options)
            this.frameBindings.push(() => target.removeEventListener(type, handler, options))
        }

        add(doc, 'input', () => {
            this.dirty = true
            this.refreshEmptyMarker(doc)
            this.scheduleSerialize()
        })
        // selectionchange is document-level and does not bubble out of the frame — hence the explicit binding.
        add(doc, 'selectionchange', () => {
            this.rememberSelection(doc)
            this.scheduleToolbarState()
        })
        add(doc, 'keydown', event => this.onFrameKeydown(event as KeyboardEvent))
        if (win) {
            // `blur` of the frame WINDOW is the frame's focus-out; focusout on the document does not fire when
            // focus leaves the frame altogether.
            add(win, 'blur', () => this.serializeNow())
        }
    }

    private disposeFrameBindings(): void {
        for (const dispose of this.frameBindings.splice(0)) dispose()
    }

    private refreshEmptyMarker(doc: Document): void {
        if (!this.placeholder) return
        if (bodyIsEmpty(doc.body)) doc.body.setAttribute(EMPTY_ATTR, '')
        else doc.body.removeAttribute(EMPTY_ATTR)
    }

    private rememberSelection(doc: Document): void {
        const selection = doc.getSelection()
        if (!selection || selection.rangeCount === 0) return
        const range = selection.getRangeAt(0)
        if (!doc.body.contains(range.commonAncestorContainer)) return
        this.savedRange = range.cloneRange()
    }

    /** Puts focus and the last known caret back into the frame; falls back to the end of the body. */
    private restoreSelection(): Selection | null {
        const doc = this.doc
        const win = doc?.defaultView
        if (!doc || !win) return null
        win.focus()
        const selection = doc.getSelection()
        if (!selection) return null
        let range = this.savedRange
        if (!range || !doc.body.contains(range.commonAncestorContainer)) {
            range = doc.createRange()
            range.selectNodeContents(doc.body)
            range.collapse(false)
        }
        selection.removeAllRanges()
        selection.addRange(range)
        return selection
    }

    private onFrameKeydown(event: KeyboardEvent): void {
        // Escape inside the frame closes an open popover, mirroring Escape inside the popover itself.
        if (event.key === 'Escape' && this.popover) {
            this.popover.close()
            this.popover = null
        }
    }

    // ----------------------------------------------------------------------------------------------
    // Serialize: frame → textarea → host
    // ----------------------------------------------------------------------------------------------

    private scheduleSerialize(): void {
        this.cancelDebounce()
        this.debounceTimer = window.setTimeout(() => {
            this.debounceTimer = null
            this.serializeNow()
        }, SERIALIZE_DEBOUNCE_MS)
    }

    private cancelDebounce(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = null
        }
    }

    /** Writes the frame's document into the textarea (design mode) and tells the page when it changed. */
    private serializeNow(): void {
        this.cancelDebounce()
        if (this.mode === 'design') {
            const doc = this.doc
            if (!doc || this.frame.contentDocument !== doc) return
            if (this.dirty) this.source.value = serialize(doc, this.shape)
        }
        this.updateStatus()
        this.announceIfChanged()
    }

    private afterSourceEdit(): void {
        this.updateStatus()
        this.announceIfChanged()
    }

    private announceIfChanged(): void {
        const value = this.source.value
        if (value === this.lastValue) return
        this.lastValue = value
        this.el.dispatchEvent(new CustomEvent('raptor:editor-change', {
            bubbles: true,
            detail: {name: this.source.name, value, mode: this.mode},
        }))
    }

    private updateStatus(): void {
        if (this.statusMode) this.statusMode.textContent = this.mode === 'design' ? 'Design' : 'HTML'
        if (this.statusChars) this.statusChars.textContent = this.source.value.length.toLocaleString()
    }

    // ----------------------------------------------------------------------------------------------
    // Mode
    // ----------------------------------------------------------------------------------------------

    private setMode(mode: EditorMode): void {
        if (mode === this.mode) return
        this.popover?.close()
        this.popover = null

        if (mode === 'source') {
            // Design → HTML: the textarea becomes the live view of what the frame held a moment ago.
            this.serializeNow()
            this.mode = mode
            this.applyModeToMarkup()
            // Caret at the top, not wherever the last source-mode visit left it: the author just switched to
            // READ the markup, and a textarea focused with a stale selection scrolls to that selection.
            this.source.setSelectionRange(0, 0)
            this.source.focus()
            this.source.scrollTop = 0
        } else {
            // HTML → Design: whatever the author typed, including a changed doctype or a fragment, is the new
            // truth; shape is re-detected inside loadDesign.
            this.mode = mode
            this.applyModeToMarkup()
            this.loadDesign()
            this.frame.contentWindow?.focus()
        }
        this.updateStatus()
    }

    private applyModeToMarkup(): void {
        const design = this.mode === 'design'
        this.el.setAttribute('data-rg-editor-mode', this.mode)
        this.frame.hidden = !design
        this.source.hidden = design
        for (const seg of this.findAll<HTMLElement>('[data-rg-editor-mode-set]')) {
            seg.setAttribute('aria-pressed', seg.getAttribute('data-rg-editor-mode-set') === this.mode ? 'true' : 'false')
        }
        // Formatting commands only mean something in the design view; the mode toggle and the host's Tools
        // stay live. `disabled` rather than `hidden` so the toolbar keeps its shape across the switch.
        for (const control of this.findAll<HTMLButtonElement | HTMLSelectElement>('[data-rg-editor-cmd]')) {
            control.disabled = this.disabled || !design
        }
        const variables = this.find<HTMLButtonElement>('.rg-editor__vars [data-rg-dropdown-trigger]')
        // Variables insert in BOTH views (setRangeText in the textarea), so only `Disabled` switches it off.
        if (variables) variables.disabled = this.disabled
    }

    // ----------------------------------------------------------------------------------------------
    // Commands
    // ----------------------------------------------------------------------------------------------

    private onToolbarClick(event: MouseEvent): void {
        const target = event.target
        if (!(target instanceof Element)) return

        const modeButton = target.closest<HTMLElement>('[data-rg-editor-mode-set]')
        if (modeButton && this.el.contains(modeButton)) {
            event.preventDefault()
            const mode = modeButton.getAttribute('data-rg-editor-mode-set')
            if (mode === 'design' || mode === 'source') this.setMode(mode)
            return
        }

        const button = target.closest<HTMLButtonElement>('button[data-rg-editor-cmd]')
        if (!button || button.disabled) return
        event.preventDefault()
        const cmd = button.getAttribute('data-rg-editor-cmd') as Command | null
        if (!cmd) return
        if (cmd === 'token') {
            const token = button.getAttribute('data-rg-editor-token')
            if (token) this.insertToken(token)
            return
        }
        this.runCommand(cmd, undefined, button)
    }

    private runCommand(cmd: Command, value?: string, anchor?: HTMLElement): void {
        if (this.disabled || this.mode !== 'design' || !this.doc) return

        switch (cmd) {
            case 'bold': this.exec('bold'); break
            case 'italic': this.exec('italic'); break
            case 'underline': this.exec('underline'); break
            case 'ul': this.exec('insertUnorderedList'); break
            case 'ol': this.exec('insertOrderedList'); break
            case 'unlink': this.exec('unlink'); break
            case 'heading':
                if (value) this.exec('formatBlock', value.toUpperCase())
                break
            case 'table':
                this.exec('insertHTML',
                    '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">'
                    + '<tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>')
                break
            case 'link':
                if (anchor) void this.promptLink(anchor)
                break
            case 'image':
                if (anchor) void this.promptImage(anchor)
                break
            case 'token':
                if (value) this.insertToken(value)
                break
        }
    }

    /**
     * `execCommand` is deprecated on paper and, for mail HTML, exactly right in practice: it produces the plain
     * `<b>`, `<i>`, `<ul>`, `<a href>` every mail client renders, with no editor-specific wrapper markup to
     * strip later. The selection is restored first because the command runs against the frame's selection and
     * the click that triggered it may have moved focus into the parent document.
     */
    private exec(command: string, value?: string): void {
        const doc = this.doc
        if (!doc) return
        this.restoreSelection()
        try {
            doc.execCommand(command, false, value)
        } catch (error) {
            console.warn(`[raptor21] editor: command "${command}" failed`, error)
        }
        this.afterEdit(doc)
    }

    private afterEdit(doc: Document): void {
        // A command can introduce text that contains a token (a pasted link text, a typed brace pair) — re-wrap,
        // the pass is idempotent. Then serialize immediately: commands are discrete, not a typing stream.
        this.dirty = true
        wrapTokens(doc.body, this.blockTokens)
        this.refreshEmptyMarker(doc)
        this.rememberSelection(doc)
        this.serializeNow()
        this.scheduleToolbarState()
    }

    private async promptLink(anchor: HTMLElement): Promise<void> {
        const doc = this.doc
        if (!doc) return
        const selection = doc.getSelection()
        const existing = this.closestAnchor(selection)
        const selectedText = selection?.toString() ?? ''
        const collapsed = !selection || selection.isCollapsed

        const values = await this.prompt(anchor, {
            title: existing ? 'Edit link' : 'Insert link',
            okLabel: existing ? 'Update' : 'Insert',
            fields: [
                {name: 'url', label: 'URL', type: 'url', placeholder: 'https://', value: existing?.getAttribute('href') ?? '', required: true, reject: UNSAFE_URL},
                {name: 'text', label: 'Text', value: selectedText || existing?.textContent || '', required: collapsed && !existing},
            ],
        })
        if (!values) return

        const url = values.url
        const text = values.text
        if (existing && (collapsed || selectedText === (existing.textContent ?? ''))) {
            // Caret inside a link, or the whole link selected: edit in place instead of nesting a new anchor.
            existing.setAttribute('href', url)
            if (text && text !== existing.textContent) existing.textContent = text
            this.afterEdit(doc)
            return
        }
        if (!collapsed && (!text || text === selectedText)) {
            // Keep whatever inline formatting the selection already carries; createLink wraps, it does not replace.
            this.exec('createLink', url)
            return
        }
        this.exec('insertHTML', `<a href="${escapeAttribute(url)}">${escapeText(text || url)}</a>`)
    }

    private async promptImage(anchor: HTMLElement): Promise<void> {
        const values = await this.prompt(anchor, {
            title: 'Insert image',
            okLabel: 'Insert',
            fields: [
                {name: 'url', label: 'Image URL', type: 'url', placeholder: 'https://cdn.example.com/…', required: true, reject: UNSAFE_URL},
                {name: 'alt', label: 'Alt text', placeholder: 'Describes the image'},
            ],
        })
        if (!values) return
        // insertHTML rather than insertImage so the alt text lands in the same edit — mail clients that block
        // remote images show exactly that text, and a second pass to find "the image just inserted" would be
        // guesswork.
        this.exec('insertHTML', `<img src="${escapeAttribute(values.url)}" alt="${escapeAttribute(values.alt ?? '')}" style="max-width:100%">`)
    }

    private prompt(anchor: HTMLElement, options: {title: string; okLabel: string; fields: Parameters<typeof openPopover>[0]['fields']}): Promise<PopoverResult> {
        this.popover?.close()
        // Capture the caret NOW: the popover's inputs take focus, and on engines that collapse an unfocused
        // frame's selection the range would be gone by the time OK is pressed.
        if (this.doc) this.rememberSelection(this.doc)
        const handle = openPopover({...options, anchor, host: this.el})
        this.popover = handle
        return handle.result.finally(() => {
            if (this.popover === handle) this.popover = null
        })
    }

    private closestAnchor(selection: Selection | null): HTMLAnchorElement | null {
        const node = selection?.anchorNode ?? null
        if (!node) return null
        const element = node instanceof Element ? node : node.parentElement
        return element?.closest('a') ?? null
    }

    // ----------------------------------------------------------------------------------------------
    // Tokens
    // ----------------------------------------------------------------------------------------------

    /** Inserts a `{token}` at the caret of whichever view is active. */
    insertToken(token: string): void {
        if (this.disabled) return
        if (this.mode === 'source') {
            const ta = this.source
            const start = ta.selectionStart ?? ta.value.length
            const end = ta.selectionEnd ?? start
            ta.setRangeText(token, start, end, 'end')
            ta.focus()
            this.afterSourceEdit()
            return
        }
        const doc = this.doc
        if (!doc) return
        this.restoreSelection()
        try {
            doc.execCommand('insertText', false, token)
        } catch (error) {
            console.warn('[raptor21] editor: insertText failed', error)
        }
        // The fresh text node is plain; wrapTokens turns it into a chip. The caret, which sat right after the
        // inserted text, ends up after the chip — exactly where continued typing belongs.
        this.afterEdit(doc)
    }

    private onDocumentClick(event: MouseEvent): void {
        const target = event.target
        if (!(target instanceof Element)) return
        const trigger = target.closest<HTMLElement>(`[${INSERT_ATTR}]`)
        if (!trigger) return
        const token = trigger.getAttribute(INSERT_ATTR)
        if (!token) return
        const forId = trigger.getAttribute(FOR_ATTR)
        // Without an explicit target the hook only reaches an editor it sits INSIDE; with one it must match
        // this editor's field. Either way a page with two editors never routes a token to the wrong one.
        const mine = forId ? this.matchesFor(forId) : this.el.contains(trigger)
        if (!mine) return
        event.preventDefault()
        this.insertToken(token)
    }

    private matchesFor(id: string): boolean {
        return id === this.source.id || id === this.source.name || (this.el.id !== '' && id === this.el.id)
    }

    // ----------------------------------------------------------------------------------------------
    // Toolbar state (pressed buttons, heading select)
    // ----------------------------------------------------------------------------------------------

    private scheduleToolbarState(): void {
        if (this.stateFrame !== null) return
        this.stateFrame = requestAnimationFrame(() => {
            this.stateFrame = null
            this.paintToolbarState()
        })
    }

    private paintToolbarState(): void {
        const doc = this.doc
        if (!doc || this.mode !== 'design' || this.disabled) return
        const states: ReadonlyArray<[Command, string]> = [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['ul', 'insertUnorderedList'], ['ol', 'insertOrderedList']]
        for (const [cmd, native] of states) {
            const button = this.find<HTMLElement>(`button[data-rg-editor-cmd="${cmd}"]`)
            if (!button) continue
            let on = false
            try { on = doc.queryCommandState(native) } catch { on = false }
            button.setAttribute('aria-pressed', on ? 'true' : 'false')
        }
        if (this.headingSelect) {
            let block = ''
            try { block = doc.queryCommandValue('formatBlock') } catch { block = '' }
            const upper = block.toUpperCase()
            const option = [...this.headingSelect.options].find(o => o.value.toUpperCase() === upper)
            this.headingSelect.value = option ? option.value : (this.headingSelect.options[0]?.value ?? '')
        }
    }
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
