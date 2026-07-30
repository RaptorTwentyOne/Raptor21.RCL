import type {RaptorProgressOptions, RaptorProgressResult} from './types'

/**
 * The public progress API.
 *
 * Installed eagerly, because a caller reaches for it from a click handler — the moment a lazily-installed
 * API would not exist yet — and would typically write `window.raptorProgress?.run(...)`, so its absence
 * would be silence rather than an error. The dialog, its markup and its loop stay behind the dynamic
 * import below, so a page that never runs one downloads none of it.
 */

export interface RaptorProgressApi {
    /**
     * Opens the dialog and drives it from `options.stream`, resolving when the stream ends.
     *
     * Errors from the stream are shown in the dialog and reported through the result's `error` rather
     * than thrown, so a failed operation always leaves the user looking at a dialog that says so.
     */
    run(options: RaptorProgressOptions): Promise<RaptorProgressResult>
}

declare global {
    interface Window {
        raptorProgress?: RaptorProgressApi
    }
}

export function installProgressApi(): void {
    window.raptorProgress = {
        run: options => import('./ProgressDialog').then(module => module.run(options)),
    }
}
