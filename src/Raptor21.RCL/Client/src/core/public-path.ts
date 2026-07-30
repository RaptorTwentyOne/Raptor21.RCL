/**
 * Points the bundle's lazy-chunk loader at wherever this bundle is actually being served from.
 *
 * Must stay the first import of the entry: the value it sets is used by every `import()` in the library,
 * and module bodies run in import order, so anything importing a chunk before this has run would use the
 * build-time default.
 *
 * The build bakes in the default route prefix, but the prefix is a public setting
 * (`RaptorOptions.RoutePrefix`). When a consumer changes it, the entry loads from the new prefix while
 * every chunk it asks for is still requested from the old one — the stylesheet applies and htmx works,
 * but no lazily-loaded component ever mounts, because the registry only logs the failed import to the
 * console.
 *
 * Deriving the path from the script's own URL removes that coupling: whatever URL the browser used to
 * fetch the entry is, by construction, the directory the chunks sit in. `document.currentScript` is null
 * in a module, so the tag is found by the marker attribute the injector writes.
 */

declare var __webpack_public_path__: string;

const entry = document.querySelector<HTMLScriptElement>('script[data-raptor21][src]');

if (entry?.src) {
    __webpack_public_path__ = new URL('.', entry.src).href;
}

export {};
