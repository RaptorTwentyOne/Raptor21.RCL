import { RaptorComponent } from '../core/Component'

/**
 * Tab switching for the server-rendered <RaptorTabs> markup.
 *
 * The nav buttons carry data-rg-tab="{panel-id}" and the panels carry that id; clicking a button shows its
 * panel and hides the rest. Scoped to this element's direct tablist/panels so a nested tab set inside a panel
 * (its own data-rg-component="tabs") mounts and switches independently.
 */
export class TabsComponent extends RaptorComponent {
    mount(): void {
        const list = this.find('.rg-tablist')
        const panelsWrap = this.find('.rg-tabpanels')
        if (!list || !panelsWrap) return

        const tabs = [...list.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute('data-rg-tab'))
        const panels = [...panelsWrap.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('rg-tabpanel'))

        const activate = (id: string) => {
            for (const tab of tabs) {
                const on = tab.getAttribute('data-rg-tab') === id
                tab.classList.toggle('rg-tab-active', on)
                tab.setAttribute('aria-selected', on ? 'true' : 'false')
            }
            for (const panel of panels) panel.classList.toggle('rg-hidden', panel.id !== id)
            this.el.dispatchEvent(new CustomEvent('raptor:tab-change', { detail: { id }, bubbles: true }))
        }

        for (const tab of tabs) {
            const id = tab.getAttribute('data-rg-tab')
            if (id) this.bind(tab, 'click', () => activate(id))
        }
    }
}
