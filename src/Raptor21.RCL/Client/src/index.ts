/**
 * Client entry point.
 *
 * The consuming application never references this script or its stylesheet by name: `AddRaptor21()`
 * registers a tag-helper component that injects both with their content-hashed URLs.
 *
 * Components are registered behind `() => import(...)` so each becomes a separate chunk, downloaded only
 * when a page declares it. The `window` APIs below are installed eagerly instead, because callers reach
 * for them at arbitrary moments and an API that only appears once a chunk resolves would be missing
 * exactly then.
 *
 * `./core/public-path` must stay the first import — see that module.
 */
import './core/public-path'
import './styles/index.scss'
import {define, start} from './core/registry'
import {installApi} from './grid/api'
import {installChartApi} from './chart/api'
import {installProgressApi} from './progress/api'
import {installNotifyApi} from './notify/api'
import {ensureHtmx} from './runtime/htmx-boot'
import {installPageLifecycle} from './runtime/page-lifecycle'
import {installPageChrome} from './runtime/page-chrome'
import {installGridFilterEntry} from './runtime/grid-filter-entry'
import {installSidebar} from './runtime/sidebar'
import {installNavigationUx} from './runtime/nav-ux'
import {installConfirm} from './runtime/confirm'
import {installModalSkeleton} from './modal/modalSkeleton'
import {harvest, installAutoHarvest, load, render, store} from './skeleton/blueprint'

define('grid', () => import('./grid/GridRoot').then(m => m.GridRoot))
define('filter', () => import('./filter/FilterPanelComponent').then(m => m.FilterPanelComponent))
define('modal', () => import('./modal/ModalComponent').then(m => m.ModalComponent))
define('select', () => import('./forms/SelectComponent').then(m => m.SelectComponent))
define('dropdown', () => import('./forms/DropdownComponent').then(m => m.DropdownComponent))
define('tabs', () => import('./tabs/TabsComponent').then(m => m.TabsComponent))
define('gallery', () => import('./gallery/GalleryComponent').then(m => m.GalleryComponent))
define('chart', () => import('./chart/ChartComponent').then(m => m.ChartComponent))

installApi()
installChartApi()
installProgressApi()
installNotifyApi()
installPageLifecycle()
installPageChrome()
installGridFilterEntry()
installSidebar()
installNavigationUx()
installConfirm()
installModalSkeleton()

declare global {
    interface Window {
        raptorSkeleton?: {
            harvest: typeof harvest
            load: typeof load
            store: typeof store
            render: typeof render
        }
    }
}

window.raptorSkeleton = {harvest, load, store, render}
installAutoHarvest()

declare global {
    interface Window {
        raptorReady?: boolean
    }
}

window.raptorReady = true
document.dispatchEvent(new CustomEvent('raptor:ready'))

void ensureHtmx().then(start)
