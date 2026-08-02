import {RaptorComponent} from '../core/Component'
import {positionAt, trackAnchor} from '../core/anchor'
import {TOP_LAYER_CLAIM_EVENT} from '../core/dialog-stack'
import {markPortalled, portalTarget} from '../core/dom'
import {focusable} from '../core/focus'
import {lockScroll, unlockScroll} from '../core/scroll-lock'

/** Open dropdowns, so opening one can close its siblings and Escape can reach the innermost. */
const open = new Set<DropdownComponent>()

/**
 * A dropdown panel: a trigger and a floating panel of arbitrary content.
 *
 * Separate from SelectComponent, though they share the popover machinery, because they answer to
 * different contracts. A select edits a form value and behaves like a listbox: one active option,
 * `aria-selected`, a value that posts. A dropdown holds whatever the page puts in it — an action menu, a
 * column chooser, a form fragment — and carries no listbox semantics.
 *
 * Markup:
 *   <div data-rg-component="dropdown">
 *     <button data-rg-dropdown-trigger>…</button>
 *     <div data-rg-dropdown-panel> … </div>
 *   </div>
 *
 * Attributes on the wrapper:
 *   data-rg-menu                      panel is a menu of [data-rg-dropdown-item]; arrows navigate it
 *   data-rg-search                    render a filter box that hides non-matching items
 *   data-rg-placement="bottom-end"    preferred side
 *   data-rg-keep-open                 clicking inside does not close (filter panels, multi-step forms).
 *                                     MIRRORED ONTO THE PANEL at mount — the panel is portalled away
 *                                     from this wrapper, and an enclosing shell popover has to be able
 *                                     to read the flag from the node it can actually see. See mount().
 */
export class DropdownComponent extends RaptorComponent {
    private trigger!: HTMLElement
    private panel!: HTMLElement
    private search: HTMLInputElement | null = null
    private isOpen = false
    private untrack: (() => void) | null = null
    private activeIndex = -1
    /**
     * Snapshotted once per open rather than tracked live, so `close()` always undoes the mode it opened
     * in even if the viewport crosses the breakpoint while the panel is open.
     */
    private sheetMode = false
    /** Lazily created, kept across opens, detached rather than destroyed on close. */
    private backdrop: HTMLElement | null = null

    private get isMenu(): boolean {
        return this.el.hasAttribute('data-rg-menu')
    }

    private get keepOpen(): boolean {
        return this.el.hasAttribute('data-rg-keep-open')
    }

    mount(): void {
        const trigger = this.find<HTMLElement>('[data-rg-dropdown-trigger]')
        const panel = this.find<HTMLElement>('[data-rg-dropdown-panel]')
        if (!trigger || !panel) {
            console.warn('[raptor21] dropdown needs [data-rg-dropdown-trigger] and [data-rg-dropdown-panel]')
            return
        }
        this.trigger = trigger
        this.panel = panel

        panel.hidden = true
        panel.classList.add('rg-dd-panel')
        markPortalled(panel)
        // KEEP-OPEN TRAVELS WITH THE PANEL, NOT WITH THE WRAPPER.
        //
        // `data-rg-keep-open` is authored on the ROOT (`RaptorDropdown.KeepOpen`), and this component
        // reads it from there — `this.el` never moves, so that half needs nothing. The half that broke is
        // the OTHER reader: `runtime/page-chrome.ts` asks `activator.closest('[data-rg-keep-open]')` from
        // the element the user pressed, to decide whether an activation inside the page-chrome menu is
        // allowed to leave that menu open. Once the panel is portalled into the menu it is no longer a
        // descendant of the wrapper, so that `closest()` walks straight past the attribute.
        //
        // Measured before this line (Chrome, real bundles, real trusted clicks, the page-chrome menu open
        // and this dropdown open inside it): pressing a plain button in a KEEP-OPEN panel logged
        // `toggle rg-pagechrome-… -> closed` + `dd-close`, byte for byte what the control group without
        // `keep-open` logged — the contract was not weakened, it was absent. `btn.closest('[data-rg-keep-
        // open]')` returned null while `wrapper.hasAttribute('data-rg-keep-open')` was true and
        // `wrapper.contains(btn)` was false, which names the re-parenting and nothing else as the cause.
        // Both widths: 1280x800 (panel inside `.rg-pagechrome-inline`) and 390x844 (sheet inside
        // `.rg-pagechrome-menu`, the ProductsPage "Upload Media in Tools" shape).
        //
        // Mirroring the attribute — rather than teaching page-chrome to find the owning component — keeps
        // the contract a pure DOM one: any host that has to ask "may I close over this activation?" asks
        // the node it can actually see, whatever runtime built it.
        if (this.keepOpen) panel.setAttribute('data-rg-keep-open', '')
        trigger.setAttribute('aria-expanded', 'false')
        trigger.setAttribute('aria-haspopup', this.isMenu ? 'menu' : 'dialog')
        if (this.isMenu) panel.setAttribute('role', 'menu')

        if (this.el.hasAttribute('data-rg-search')) this.buildSearch()

        // Portalled for the same reason as the select panel: any scrolling or transformed ancestor
        // would otherwise clip it. `portalTarget` — not a bare `document.body` — because a host that
        // sits inside a popover which is ALREADY showing (an htmx swap inside the open "…" menu) must
        // land in that popover's subtree, or the panel is stranded under the top layer for its whole
        // first open. `openPanel()` recomputes the target on every open, so this only has to be right
        // for the case where the panel is used before any close/open cycle has happened.
        portalTarget(this.el).appendChild(panel)
        // Panel children may carry hx-* attributes. Depending on whether htmx's swap processing or this
        // mount reached the subtree first, the moved panel can end up with unbound hx elements;
        // htmx.process is idempotent, so calling it here makes the binding deterministic.
        ;(window as unknown as { htmx?: { process?: (el: Element) => void } }).htmx?.process?.(panel)
        this.onDestroy(() => {
            this.close()
            this.backdrop?.remove()
            // Return the panel into the component root rather than discarding it. Inside an
            // hx-preserve'd ancestor, a boosted body swap detaches and re-attaches the root, which the
            // registry sees as an unmount followed by a fresh mount, and that mount must be able to find
            // the panel again. When the root is gone for real, the panel is collected with it.
            this.el.appendChild(panel)
        })
        // The snapshot-time counterpart of the return above. htmx snapshots the page it is leaving at
        // `htmx:beforeHistorySave`, scoped to `hx-history-elt` (#app-root) and BEFORE this component is
        // destroyed — while the panel still sits under <body>, outside that scope. Without this, the
        // snapshot holds a trigger with no panel and every Back restores a dead dropdown. The event
        // fires synchronously right before the clone, so returning the panel here puts it inside the
        // captured subtree; the destroy that follows the swap finds it already home, and a component
        // that survives re-portals it on the next open.
        this.onDocument('htmx:beforeHistorySave', () => {
            this.close()
            this.el.appendChild(panel)
        })

        this.bind(trigger, 'click', event => {
            event.preventDefault()
            this.toggle()
        })
        this.bind(trigger, 'keydown', event => this.onTriggerKeydown(event as KeyboardEvent))
        this.bind(panel, 'click', event => this.onPanelClick(event as MouseEvent))
        this.bind(panel, 'keydown', event => this.onPanelKeydown(event as KeyboardEvent))

        this.onDocument('pointerdown', event => {
            if (!this.isOpen) return
            const target = event.target
            if (target instanceof Node && !panel.contains(target) && !this.el.contains(target)) this.close()
        })

        // Close when an ancestor POPOVER closes.
        //
        // NOT optional bookkeeping. Once the panel lives inside the rail (see `portalTarget`), the rail
        // closing takes the panel with it — `_sidebar.scss` §3 hides the whole closed subtree with
        // `.rg-sidebar[popover]:not(:popover-open) { display: none }` — while this component still
        // believes it is open. `isOpen` would stay true, `unlockScroll()` would never run, and the page
        // would be left unscrollable behind nothing at all; the shared counter in core/scroll-lock.ts is
        // exactly what runtime/sidebar.ts §2 already documents as un-resettable from one owner.
        //
        // capture: true is REQUIRED — `toggle` does not bubble, so a document-level listener only ever
        // sees it during capture. Same pattern, same reason, as runtime/sidebar.ts and page-chrome.ts.
        //
        // Narrowed to `[popover]` hosts on purpose: `<details>` fires `toggle` with the same
        // `newState: 'closed'` payload, and a dropdown is not something a <details> ancestor owns.
        this.onDocument('toggle', event => {
            if (!this.isOpen) return
            if ((event as ToggleEvent).newState !== 'closed') return
            const host = event.target
            if (!(host instanceof HTMLElement) || !host.hasAttribute('popover')) return
            if (!host.contains(this.el)) return
            this.close()
        }, {capture: true})

        // Close when a <dialog> takes the top layer.
        //
        // THE LISTENER ABOVE CANNOT COVER THIS, and the gap is not theoretical. A modal `<dialog>` is
        // not a popover, so it fires no `toggle` at all on the way in; and it is not an ANCESTOR of this
        // panel, so an ancestor-scoped test could never match it anyway — `showModal()` acts on everyone
        // it does NOT contain. Nothing else in this component's contract notices it either: the panel is
        // not clicked, not scrolled and not re-parented, so `pointerdown`, `close()` and `portalTarget`
        // all stay untouched and the component goes on believing it is open. `portalTarget` is only
        // re-resolved by the NEXT `openPanel()`, which is a call that can no longer happen.
        //
        // MEASURED (Chrome 150, real bundles, /roles, a row's action menu open under `<body>`, then a
        // `.rg-modal` opened over it): `hidden: false`, `checkVisibility(): true`, `aria-expanded="true"`
        // and the same rect `{x: 1576, y: 174, w: 176, h: 78}` as before — while `elementsFromPoint` at
        // the panel's own centre returned `DIALOG.rg-modal`. Visible, and dead. In sheet mode it is worse
        // than dead: the sheet holds a `lockScroll()` that only `close()` releases, so the page behind
        // the dialog stays unscrollable after the dialog itself is gone.
        //
        // A claim from a host that CONTAINS this wrapper is ignored: that dialog owns the dropdown rather
        // than displacing it (a menu opened inside a dialog, or a dialog swapped in around one), and
        // closing there would shut a panel the user just opened.
        this.onDocument(TOP_LAYER_CLAIM_EVENT, event => {
            if (!this.isOpen) return
            const host = (event as CustomEvent<{ host: HTMLElement }>).detail?.host
            if (host?.contains(this.el)) return
            this.close()
        })
    }

    private buildSearch(): void {
        // Reuse the input if this is a remount of a returned panel: the hx-preserve unmount/remount cycle
        // would otherwise prepend a second search box on every swap.
        const existing = this.panel.querySelector<HTMLInputElement>(':scope > .rg-dd-search')
        if (existing) {
            this.search = existing
        } else {
            this.search = document.createElement('input')
            this.search.type = 'text'
            this.search.className = 'rg-dd-search'
            this.search.placeholder = 'Search…'
            this.search.autocomplete = 'off'
            this.search.setAttribute('aria-label', 'Search')
            this.panel.prepend(this.search)
        }
        this.bind(this.search, 'input', () => this.filter())
    }

    private items(): HTMLElement[] {
        return [...this.panel.querySelectorAll<HTMLElement>('[data-rg-dropdown-item]')].filter(
            item => !item.hidden && item.getAttribute('aria-disabled') !== 'true',
        )
    }

    private filter(): void {
        const term = this.search?.value.trim().toLowerCase() ?? ''
        let anyVisible = false

        for (const item of this.panel.querySelectorAll<HTMLElement>('[data-rg-dropdown-item]')) {
            const match = !term || (item.textContent ?? '').toLowerCase().includes(term)
            item.hidden = !match
            if (match) anyVisible = true
        }

        // Section headings whose items all filtered out would otherwise float over nothing.
        for (const group of this.panel.querySelectorAll<HTMLElement>('[data-rg-dropdown-group]')) {
            const visible = [...group.querySelectorAll<HTMLElement>('[data-rg-dropdown-item]')].some(i => !i.hidden)
            group.hidden = !visible
        }

        const empty = this.panel.querySelector<HTMLElement>('[data-rg-dropdown-empty]')
        if (empty) empty.hidden = anyVisible

        this.activeIndex = -1
        this.paintActive()
        // A sheet is pinned to the viewport edge by CSS, not by the floating-panel math; re-running
        // positionAt here would stamp inline top/left onto it and fight the sheet's own layout.
        if (!this.sheetMode) positionAt(this.panel, this.trigger, this.anchorOptions())
    }

    /**
     * Creates the sheet's backdrop once and keeps it for the component's lifetime, detaching it between
     * opens. It needs no reconnect guard because, unlike the panel, nothing outside this component ever
     * touches it.
     */
    private ensureBackdrop(): HTMLElement {
        if (!this.backdrop) {
            const backdrop = document.createElement('div')
            backdrop.className = 'rg-dd-backdrop'
            // Marked for the same reason as the panel: `openPanel()` inserts it into the SAME parent, so
            // it lands in the open popover too and is just as much a "child" for that host's own layout
            // rules — and it is not, and never was, anything the author put there.
            markPortalled(backdrop)
            this.bind(backdrop, 'click', () => this.close())
            this.backdrop = backdrop
        }
        return this.backdrop
    }

    private anchorOptions() {
        const placement = this.el.dataset.rgPlacement
        return {
            placement: (placement as 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end') ?? 'bottom-start',
            matchWidth: this.el.hasAttribute('data-rg-match-width'),
        }
    }

    toggle(): void {
        if (this.isOpen) this.close()
        else this.openPanel()
    }

    openPanel(): void {
        if (this.isOpen) return

        // Where the panel has to live for THIS open — recomputed every time, never cached.
        //
        // Two independent reasons the parent can be wrong on entry, and one reason the ANSWER itself
        // moves between opens:
        //   · the history-save handler above deliberately moves the panel back into the wrapper, and a
        //     boosted body swap detaches a panel parented to <body>;
        //   · the target depends on whether an ancestor popover is showing RIGHT NOW — the same trigger
        //     in the sidebar's foot resolves to the rail when the drawer is open and to <body> when it
        //     is docked on desktop. See `portalTarget` for the measurements behind that.
        // Re-attach by reference; the node and its content are untouched, only its parent changes.
        //
        // IT MUST STAY AT THE TOP OF THIS METHOD — the move is only free while the panel is still
        // `hidden`. Two measured reasons:
        //   · re-parenting a SHOWING sheet restarts `rg-sheet-up` (styles/forms/_select.scss): moving an
        //     already-open panel put its rect back at y = 844, the viewport's bottom edge, mid-animation;
        //   · moving a node that holds focus blurs it, so a move after the `first?.focus()` below drops
        //     `document.activeElement` to <body>.
        const target = portalTarget(this.el)
        if (this.panel.parentElement !== target) target.appendChild(this.panel)

        // A menu is a transient layer, so an open sibling is dismissed rather than left stacked beneath
        // it. A keep-open panel is a workspace and is left alone.
        for (const other of [...open]) if (!other.keepOpen) other.close()

        // Decided once per open, before anything below reads it, so filter() and the positioning branch
        // agree on which mode they are in.
        this.sheetMode = window.matchMedia?.('(max-width: 991.98px)').matches ?? false

        this.isOpen = true
        open.add(this)
        this.panel.hidden = false
        this.trigger.setAttribute('aria-expanded', 'true')

        if (this.sheetMode) {
            // An earlier desktop-mode open may have left inline positioning behind, and inline styles
            // beat the sheet class's own top/left/position, so they are cleared.
            this.panel.style.position = ''
            this.panel.style.top = ''
            this.panel.style.left = ''
            this.panel.style.minWidth = ''
            this.panel.classList.add('rg-dd-sheet')
            const backdrop = this.ensureBackdrop()
            // Paint one frame at opacity 0, then clear it back to the class's opacity: 1. That gap is
            // what the backdrop's transition animates; inserting it already at 1 would be a no-op.
            backdrop.style.opacity = '0'
            // Into the SAME parent as the panel, not into <body>. The backdrop is an ordinary fixed box
            // at `--rg-z-popover - 10`, so leaving it under <body> while the panel sits in an open
            // popover's subtree puts it under the top layer: measured, the sheet's own dimming stopped
            // painting entirely while the sheet itself was fine. `insertBefore(…, this.panel)` keeps it
            // the panel's immediate previous sibling, which is what orders the two without a z-index.
            target.insertBefore(backdrop, this.panel)
            requestAnimationFrame(() => (backdrop.style.opacity = ''))
            // A sheet covers the viewport like any other full-screen overlay; counted, so it nests
            // safely with a modal or another sheet already holding the lock.
            lockScroll()
        }

        if (this.search) {
            this.search.value = ''
            this.filter()
        }

        if (!this.sheetMode) {
            positionAt(this.panel, this.trigger, this.anchorOptions())
            this.untrack = trackAnchor(this.panel, this.trigger, this.anchorOptions())
        }

        this.activeIndex = -1
        // A touch tap that opens the panel must not also pop the on-screen keyboard: coarse pointers
        // skip autofocus entirely and wait for the user to tap the search box themselves.
        const pointerFine = window.matchMedia?.('(pointer: fine)').matches ?? true
        const first = this.search ?? (this.isMenu ? null : focusable(this.panel)[0] ?? null)
        if (pointerFine) first?.focus()

        this.el.dispatchEvent(new CustomEvent('raptor:dropdown-open', {bubbles: true}))
    }

    close(): void {
        if (!this.isOpen) return
        this.isOpen = false
        open.delete(this)
        this.panel.hidden = true
        this.trigger.setAttribute('aria-expanded', 'false')
        this.trigger.removeAttribute('aria-activedescendant')
        this.untrack?.()
        this.untrack = null

        if (this.sheetMode) {
            this.panel.classList.remove('rg-dd-sheet')
            this.backdrop?.remove()
            unlockScroll()
        }
        this.sheetMode = false

        this.el.dispatchEvent(new CustomEvent('raptor:dropdown-close', {bubbles: true}))
    }

    private onPanelClick(event: MouseEvent): void {
        const target = event.target
        if (!(target instanceof Element)) return

        if (target.closest('[data-rg-dropdown-close]')) {
            this.close()
            this.trigger.focus()
            return
        }

        // A menu item is a command, so acting on it dismisses the menu. A keep-open panel holds a form,
        // where a click must not throw away what the user is doing.
        const item = target.closest<HTMLElement>('[data-rg-dropdown-item]')
        if (item && !this.keepOpen) {
            this.close()
            this.trigger.focus()
        }
    }

    private onTriggerKeydown(event: KeyboardEvent): void {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            this.openPanel()
            if (this.isMenu) this.move(1)
        }
    }

    private onPanelKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            this.close()
            this.trigger.focus()
            return
        }

        if (!this.isMenu && !this.search) return

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault()
                this.move(1)
                break
            case 'ArrowUp':
                event.preventDefault()
                this.move(-1)
                break
            case 'Enter': {
                const item = this.items()[this.activeIndex]
                if (item) {
                    event.preventDefault()
                    item.click()
                }
                break
            }
        }
    }

    private move(delta: number): void {
        const items = this.items()
        if (items.length === 0) return
        this.activeIndex = (this.activeIndex + delta + items.length) % items.length
        this.paintActive()
        // Focus follows real items, so Enter and screen-reader navigation agree. When there is a search
        // box it keeps focus instead, and the highlight is announced through aria-activedescendant.
        if (!this.search) items[this.activeIndex].focus()
    }

    private paintActive(): void {
        const items = this.items()
        items.forEach((item, index) => {
            const active = index === this.activeIndex
            item.classList.toggle('rg-active', active)
            if (active) {
                item.id ||= `rg-dd-item-${Math.abs(index)}-${this.el.id || 'dd'}`
                this.search?.setAttribute('aria-activedescendant', item.id)
            }
        })
        if (this.activeIndex < 0) this.search?.removeAttribute('aria-activedescendant')
    }
}
