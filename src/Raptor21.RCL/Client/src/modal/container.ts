/**
 * The element every imperatively-built dialog is appended to.
 *
 * One shared host rather than one per feature, because `ModalComponent.applyInertBelow()` walks
 * `document.body.children` and marks every child that does not contain the topmost dialog `inert`. A
 * second container would be a second body child, so as soon as one dialog opened over another, whichever
 * container did not hold the top of the stack would be marked inert and a visible dialog would go dead to
 * the pointer and the tab order. Sharing one container keeps the whole stack inside a single branch that
 * `applyInertBelow` always skips.
 *
 * The id matches the container a host application's shell renders (`<div id="modal-container">`), so an
 * imperative dialog lands beside the server-rendered ones and stacks against them. Created on demand, so
 * the library keeps working on a host that renders no such element.
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
