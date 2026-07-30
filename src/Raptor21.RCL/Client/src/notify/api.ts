import {NotifyManager} from './NotifyManager'
import type {RaptorNotifyApi} from './types'

/**
 * The public toast / confirm API.
 *
 * Both the API and its implementation are eager, with no dynamic import behind them, because of the call
 * shape: `raptorNotify.success(...)` returns void and is typically called from the tail of a mutation
 * handler, so a chunk that failed to fetch would be a message that silently never appeared, with no
 * promise for anyone to observe the failure on.
 *
 * Installed once, from the bundle entry. The manager keeps no per-page state beyond a cached container
 * element it re-resolves whenever the document no longer holds it, so it survives boosted navigation.
 */

declare global {
    interface Window {
        raptorNotify?: RaptorNotifyApi
    }
}

export function installNotifyApi(): void {
    window.raptorNotify = new NotifyManager()
}
