import type {RaptorComponent} from './Component'

type ComponentCtor = new (el: HTMLElement) => RaptorComponent
type Loader = () => Promise<ComponentCtor>

const loaders = new Map<string, Loader>()

/** One live instance per element, so a re-scan cannot mount the same element twice. */
const mounted = new WeakMap<HTMLElement, RaptorComponent>()

/** Elements currently being loaded, so a burst of scans issues one import, not several. */
const pending = new WeakSet<HTMLElement>()

const ATTR = 'data-rg-component'

/**
 * Registers a component behind a lazy loader.
 *
 * The loader is a `() => import(...)`, so the bundler emits each component as its own chunk: a page
 * with a grid and no modal downloads no modal code. Registration only records the name.
 */
export function define(name: string, loader: Loader): void {
    loaders.set(name, loader)
}

/**
 * Mounts every declared component inside `root` that is not mounted yet.
 *
 * Markup declares its behaviour with `data-rg-component="grid"`, so the server decides what runs and
 * the client never hardcodes a selector per feature.
 */
export function mountAll(root: ParentNode = document): void {
    const elements = [...root.querySelectorAll<HTMLElement>(`[${ATTR}]`)]
    if (root instanceof HTMLElement && root.hasAttribute(ATTR)) elements.unshift(root)

    for (const el of elements) {
        if (mounted.has(el) || pending.has(el)) continue

        const name = el.getAttribute(ATTR)
        if (!name) continue

        const loader = loaders.get(name)
        if (!loader) {
            console.warn(`[raptor21] no component registered for "${name}"`)
            continue
        }

        pending.add(el)
        void loader()
            .then(Ctor => {
                if (!el.isConnected) return
                const instance = new Ctor(el)
                mounted.set(el, instance)
                instance.mount()
                settle(el, instance)
            })
            .catch(error => console.error(`[raptor21] failed to mount "${name}"`, error))
            .finally(() => pending.delete(el))
    }
}

/** Destroys the instance on an element and on every declared descendant. */
export function destroyIn(root: ParentNode): void {
    const elements = [...root.querySelectorAll<HTMLElement>(`[${ATTR}]`)]
    if (root instanceof HTMLElement && root.hasAttribute(ATTR)) elements.unshift(root)

    for (const el of elements) {
        const instance = mounted.get(el)
        if (!instance) continue
        mounted.delete(el)
        instance.destroy()
    }
}

/** The live instance for an element, for components that need to talk to a sibling. */
export function instanceOf<T extends RaptorComponent>(el: HTMLElement | null): T | null {
    return el ? ((mounted.get(el) as T | undefined) ?? null) : null
}

/** Resolvers waiting for an element to finish mounting, keyed by that element. */
const waiters = new WeakMap<HTMLElement, Array<(instance: RaptorComponent) => void>>()

function settle(el: HTMLElement, instance: RaptorComponent): void {
    const pendingWaiters = waiters.get(el)
    if (!pendingWaiters) return
    waiters.delete(el)
    for (const resolve of pendingWaiters) resolve(instance)
}

/**
 * Resolves with an element's instance once it has mounted.
 *
 * Used wherever an eagerly-installed API has to reach a lazily-imported component: the caller runs at an
 * arbitrary moment and cannot know whether the chunk has landed yet, and a synchronous `instanceOf`
 * returns null in that window.
 *
 * Rejects rather than hanging when the element declares no component, so a wiring mistake surfaces
 * instead of leaving a promise that never settles.
 */
export function whenMounted<T extends RaptorComponent>(el: HTMLElement): Promise<T> {
    const existing = mounted.get(el)
    if (existing) return Promise.resolve(existing as T)

    if (!el.hasAttribute(ATTR)) {
        return Promise.reject(new Error(`[raptor21] element declares no ${ATTR}, so it will never mount`))
    }

    return new Promise<T>(resolve => {
        const list = waiters.get(el)
        if (list) list.push(resolve as (instance: RaptorComponent) => void)
        else waiters.set(el, [resolve as (instance: RaptorComponent) => void])

        mountAll(el)
    })
}

let started = false

/**
 * Starts the lifecycle.
 *
 * htmx replaces whole regions, so mounting once at load is not enough — and the removed subtree's
 * components must be torn down or their document-level listeners outlive the DOM they act on. A
 * MutationObserver covers every source of change (htmx, the host's own code, anything else) rather
 * than trusting one framework's event.
 */
export function start(): void {
    if (started) return
    started = true

    const observer = new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.removedNodes) {
                if (node instanceof HTMLElement) destroyIn(node)
            }
        }
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node instanceof HTMLElement) mountAll(node)
            }
        }
    })

    const begin = () => {
        mountAll(document)
        observer.observe(document.body, {childList: true, subtree: true})
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, {once: true})
    else begin()
}
