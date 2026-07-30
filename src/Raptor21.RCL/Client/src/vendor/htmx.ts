/**
 * Vendored htmx, emitted as its own bundle so it can be left out when a consumer already loads htmx —
 * two htmx instances on one page double-fire every event. `runtime/htmx-boot.ts` decides at load time
 * whether this bundle is needed.
 *
 * The npm package's entry exports htmx but never assigns the global, so importing it alone leaves
 * `window.htmx` undefined and every `hx-*` attribute inert. The global is the contract other code reads,
 * so it is published explicitly here.
 */
import htmx from 'htmx.org'

declare global {
    interface Window {
        htmx?: typeof htmx
    }
}

window.htmx = htmx

export default htmx
