/**
 * The client half of the server's RaptorState.
 *
 * The server decides which pane a component starts in, so the first paint is already correct; this
 * switches it afterwards — a chart whose draw threw, a region whose refresh came back empty.
 *
 * Only `hidden` on panes the server already rendered is toggled; a pane is never built here. Markup
 * created on the client carries no CSS-isolation scope attribute, so scoped rules would not match it and
 * the pane would paint unstyled — which is why the server renders all of them.
 */

/** Wire names, matching Raptor21.RCL.States.RaptorStateNames.Wire(). */
export type RaptorStateName = 'content' | 'loading' | 'empty' | 'error'

const PANE = '[data-rg-state]'
const HOST = 'data-rg-state-host'

/**
 * Shows `next` and hides the other panes under `root`.
 *
 * Panes are looked up under `root` only, so nested state hosts (a chart inside a region that also has
 * states) do not fight over each other's panes.
 */
export function applyState(root: HTMLElement, next: RaptorStateName): void {
  for (const pane of Array.from(root.querySelectorAll<HTMLElement>(PANE))) {
    if (pane.parentElement?.closest(`[${HOST}]`) !== root) continue
    pane.hidden = pane.dataset.rgState !== next
  }

  root.setAttribute(HOST, next)
}

/** The state a host is currently showing, or 'content' if it never declared one. */
export function currentState(root: HTMLElement): RaptorStateName {
  return (root.getAttribute(HOST) as RaptorStateName | null) ?? 'content'
}
