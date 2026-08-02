/**
 * The element every imperatively-built dialog is appended to.
 *
 * A PLACEMENT DETAIL NOW, NOT A CORRECTNESS ONE — read this before treating it as load-bearing again.
 * It used to be: `ModalComponent.applyInertBelow()` walked `document.body.children` and marked every
 * child that did not contain the topmost dialog `inert`, so a second container would have gone inert the
 * moment a dialog opened in the first one, leaving a visible dialog dead to the pointer. That pass is
 * gone — modality is `<dialog>.showModal()`'s, and the UA scopes inertness to the dialog's own subtree
 * rather than to a body child.
 *
 * What is left is grouping, and one measured non-reason to move dialogs here: geometry. A `<dialog>` in
 * the top layer resolves against the viewport wherever it sits — measured, one rendered five levels deep
 * inside `.rg-sidebar-pushed` / `.rg-sidebar-pushclip` (a 240px push under `overflow-x: clip`) still
 * gave `{0, 781, 390, 63}` on `showModal()`, escaping both the push and the clip. Re-measured after the
 * push became a `translate` rather than a `margin-inline-start`, which is the harder case because a
 * transform DOES create a containing block for ordinary fixed descendants: unchanged, `[0,0,200,120]`
 * with and without a 240px translate on the ancestor. A top-layer element's containing block is the
 * viewport whatever its ancestors carry, and that is what the RCL's Push mode now relies on. So an imperative dialog does not have to be moved anywhere to be positioned correctly; it is
 * kept together with the server-rendered ones because a single, predictable host is easier to reason
 * about than several.
 *
 * The id matches the container a host application's shell renders (`<div id="modal-container">`).
 * Created on demand, so the library keeps working on a host that renders no such element.
 */
export function modalContainer(): HTMLElement {
    let el = document.getElementById('modal-container')
    if (!el) {
        el = document.createElement('div')
        el.id = 'modal-container'
        document.body.appendChild(el)
    }
    return el
}
