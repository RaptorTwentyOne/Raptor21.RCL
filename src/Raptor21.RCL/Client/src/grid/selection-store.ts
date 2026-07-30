import { cssEscape } from '../core/dom'

/**
 * Selected row keys, per grid id.
 *
 * Selection accumulates across filter/sort/page changes and spans pages, so it has to outlive the
 * region — and the region is exactly what htmx replaces. A swap destroys the feature and mounts a fresh
 * one, so instance fields would take the selection with them. In memory only: a full page load starts
 * with an empty selection.
 *
 * The store lives outside the feature so the public API can be installed eagerly, without waiting for a
 * grid's lazily-imported chunk to arrive.
 */
const selections = new Map<string, Set<string>>()

export function selectionOf(gridId: string): Set<string> {
    let set = selections.get(gridId)
    if (!set) {
        set = new Set<string>()
        selections.set(gridId, set)
    }
    return set
}

export function peekSelection(gridId: string): readonly string[] {
    return [...(selections.get(gridId) ?? [])]
}

export function clearSelection(gridId: string): void {
    selections.get(gridId)?.clear()
    for (const el of document.querySelectorAll<HTMLElement>(`.raptor-grid[data-grid-id="${cssEscape(gridId)}"]`)) {
        paintSelection(el, gridId)
    }
}

/**
 * Applies a grid's set to its DOM: row checkboxes, the row highlight, the select-all tri-state and the
 * "N selected" bar. A free function because it must work with or without a mounted component.
 */
export function paintSelection(el: HTMLElement, gridId: string): void {
    const set = selections.get(gridId) ?? new Set<string>()

    const own = <T extends Element>(selector: string): T[] =>
        [...el.querySelectorAll<T>(selector)].filter(node => node.closest('.raptor-grid') === el)

    const rows = own<HTMLInputElement>('.rg-sel-row')
    let checkedOnPage = 0
    for (const box of rows) {
        const on = set.has(box.value)
        box.checked = on
        box.closest('tr')?.classList.toggle('rg-row-sel', on)
        if (on) checkedOnPage++
    }

    const all = own<HTMLInputElement>('.rg-sel-all')[0]
    if (all) {
        all.checked = rows.length > 0 && checkedOnPage === rows.length
        all.indeterminate = checkedOnPage > 0 && checkedOnPage < rows.length
    }

    const bar = own<HTMLElement>('[data-rg-selbar]')[0]
    if (bar) bar.hidden = set.size === 0

    const count = own<HTMLElement>('[data-rg-selcount]')[0]
    if (count) count.textContent = `${set.size} selected`
}
