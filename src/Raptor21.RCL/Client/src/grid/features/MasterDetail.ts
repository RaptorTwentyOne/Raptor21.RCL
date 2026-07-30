import { GridFeature } from '../GridFeature'
import { closest } from '../../core/dom'
import { GridLayout } from './GridLayout'

/**
 * Elements that own their own click behaviour and affordance, so a card tap must leave them alone:
 * pressing a link or a checkbox inside a card is not a request to expand the row, and giving it a
 * ripple would claim otherwise. `data-rg-no-expand` opts arbitrary markup out; `data-rg-no-ripple`
 * suppresses only the visual.
 */
const CARD_PASSIVE = 'button, a, input, select, textarea, label, [data-rg-no-expand], [data-rg-no-ripple]'

/**
 * Master-detail: expanding a data row into the detail panel rendered beneath it.
 *
 * `toggleRowDetail` is the single source of truth for that transition, and is public because the card
 * layer drives it too: in card mode a tap on the card expands the row.
 */
export class MasterDetail extends GridFeature {
    private sizeRaf = 0

    override init(): void {
        this.onDestroy(() => {
            if (this.sizeRaf) cancelAnimationFrame(this.sizeRaf)
            this.sizeRaf = 0
        })

        this.on('click', event => {
            const btn = closest<HTMLElement>(event.target, '.rg-expand')
            if (!btn || !this.isOwn(btn)) return
            this.toggleRowDetail(closest<HTMLElement>(btn, 'tr'))
        })

        // Card mode hides the expand cell entirely, so tapping the card is the only way to open a detail
        // there. Interactive elements inside the card keep their own behaviour.
        this.on('click', event => {
            const card = closest<HTMLElement>(event.target, '.raptor-grid.rg-cards.rg-has-cards .rg-card')
            if (!card || !this.isOwn(card)) return
            if (closest(event.target, 'button, a, input, select, textarea, label, [data-rg-no-expand]')) return
            this.toggleRowDetail(closest<HTMLElement>(card, 'tr'))
        })

        this.on('pointerdown', event => this.ripple(event as PointerEvent))
    }

    /**
     * Opens or closes the detail row that follows `tr`.
     *
     * The detail is fetched exactly once: `data-loaded` marks the row the moment the first open starts,
     * so re-opening only flips visibility instead of re-issuing the request. Both chevrons follow the
     * state — the button's via aria-expanded, the card's via the row's `.rg-open` class.
     */
    toggleRowDetail(tr: HTMLElement | null): void {
        if (!tr || !this.isOwn(tr)) return

        const detailRow = tr.nextElementSibling
        if (!(detailRow instanceof HTMLElement) || !detailRow.classList.contains('rg-detail-row')) return

        const btn = tr.querySelector<HTMLElement>('.rg-expand')

        const opening = detailRow.hasAttribute('hidden')
        if (opening) detailRow.removeAttribute('hidden')
        else detailRow.setAttribute('hidden', '')
        btn?.setAttribute('aria-expanded', opening ? 'true' : 'false')
        tr.classList.toggle('rg-open', opening)

        if (opening && !detailRow.dataset.loaded) {
            detailRow.dataset.loaded = '1'
            const url = btn?.getAttribute('data-rg-detail-url')
            const target = detailRow.querySelector<HTMLElement>(':scope > .rg-detail-cell > .rg-detail')
            const htmx = window.htmx
            if (url && target && htmx) void htmx.ajax('get', url, { target, swap: 'innerHTML' })
        }

        if (opening) this.scheduleDetailSizing()
    }

    /**
     * Re-size the open panels after the browser has laid the newly-shown row out: the width comes from
     * the scroll viewport, and revealing a row can change it (a vertical scrollbar appearing), so
     * measuring in the same tick reads the pre-expansion value.
     *
     * Only the detail sizing is re-run, not a whole layout pass: opening a row changes nothing about
     * column widths or pinning, and in card mode a full pass would strip the inline widths this needs.
     * Several rows opening in one frame are coalesced into a single pass.
     */
    private scheduleDetailSizing(): void {
        if (this.sizeRaf) return
        this.sizeRaf = requestAnimationFrame(() => {
            this.sizeRaf = 0
            this.grid.feature(GridLayout)?.sizeDetails()
        })
    }

    /**
     * Tap ripple on cards: a circle growing from the touch point. Fires on pointerdown rather than
     * click, so the feedback is immediate under a finger.
     */
    private ripple(event: PointerEvent): void {
        if (!this.grid.isCards || !this.el.classList.contains('rg-has-cards')) return

        const card = closest<HTMLElement>(event.target, '.rg-card')
        if (!card || !this.isOwn(card)) return
        if (closest(event.target, CARD_PASSIVE)) return

        const rect = card.getBoundingClientRect()
        const size = Math.max(rect.width, rect.height)
        const ripple = document.createElement('span')
        ripple.className = 'rg-ripple'
        ripple.style.width = ripple.style.height = `${size}px`
        ripple.style.left = `${event.clientX - rect.left - size / 2}px`
        ripple.style.top = `${event.clientY - rect.top - size / 2}px`
        card.appendChild(ripple)
        ripple.addEventListener('animationend', () => ripple.remove())
    }
}
