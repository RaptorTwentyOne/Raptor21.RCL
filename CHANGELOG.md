# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version a release is published under comes from its git tag — `.github/workflows/release.yml`
passes `-p:Version` derived from the tag, so the number in `Raptor21.RCL.csproj` is the local
default only. Tag and heading below must agree.

## [Unreleased]

## [0.2.0-preview.1] - 2026-08-02

Shipping as a **preview**, like `0.1.0-preview.1` before it: this is the first release of the
top-layer overlay work and it has been exercised by exactly one consumer. The contract changes below
are the ones worth reviewing against a second consumer before `0.2.0` proper is cut. Nothing here is
expected to change — the preview suffix buys the chance to find out that it should.

Every overlay this library opens now lives in the browser's **top layer** — native `<dialog>` and
native `popover` — instead of in the normal layer at a `z-index`. That single change is the reason
almost every item below is breaking: `z-index` cannot order the top layer from the normal layer in
either direction, so a host rule that used to place, stack or hide one of these surfaces now does
nothing, silently.

The measurement behind it, repeated across the components: with the sidebar rail showing as a
popover, a `<body>` child probe at `z-index` 300, 400, 500, 600, 700 **and 2147483647** was returned
*underneath* the rail by `elementsFromPoint` in all six cases.

### Why 0.2.0-preview.1 (SemVer rationale)

Under SemVer, `0.x` may carry breaking changes in a minor bump, and this release uses that
allowance rather than pretending the surface is stable. It is *not* a patch release: the rendered
element type of `RaptorModal` changed, `RaptorSidebar` changed its markup, its attributes and its
open/close mechanism, the layout selector changed a response header, and the client's portal target
became conditional. Any one of those can break a consumer that only reads its stylesheet.

It is not `1.0.0` either — `README.md` still states that nothing in `0.x` is a compatibility
commitment, and this release widens the surface (three new components, three new enums, a published
token block) rather than settling it.

Consumers pinning an exact version, as the README asks, are unaffected until they choose to move.

---

### Breaking changes

Each entry states **what** changed, **who** it breaks, and **how** to migrate.

#### 1. `.rg-modal` renders a native `<dialog>`, not a `<div>`

**What.** `RaptorModal.razor` and `RaptorModalTagHelper` (`output.TagName`) now emit
`<dialog class="rg-modal">`. It renders **closed** and is opened with `showModal()` from
`Client/src/modal/open.ts`; the stylesheet reinforces the closed state at author specificity
(`dialog.rg-modal:not([open]) { display: none }`) so nothing paints in the normal layer between the
htmx swap and the component mounting.

**Who breaks.**

- Host CSS with an element-qualified selector — `div.rg-modal`, `.modal-host > div` — no longer
  matches.
- Host CSS setting `z-index`, `position` or `inset` on `.rg-modal`. These are now inert: a top-layer
  element resolves against the viewport and outranks the whole normal layer regardless.
- Host CSS forcing visibility at specificity ≥ (0,1,1) — for example `#shell .rg-modal { display: flex }`
  — now beats the closed-state rule and paints an unopened dialog.
- Host script that opened or closed a modal by touching `style.display`, `hidden` or a class. Only
  `showModal()` / `close()` put the element in and out of the top layer.

**How to migrate.** Delete `z-index` / `position` / `inset` / `display` rules for `.rg-modal`; drop
the element qualifier from selectors; open and close through the component's own API.

#### 2. Confirm, progress, modal skeleton and gallery lightbox are `<dialog>` too

**What.** `window.raptorNotify.confirm()`, `window.raptorProgress`, the modal skeleton placeholder
and the gallery lightbox are all built as a native `<dialog>` and opened with `showModal()`. The
hand-rolled numbers they used are gone — the confirm's `z-index: 2147483600` in particular.

**Who breaks.** Host CSS that stacked its own surface against those numbers, or that set `z-index`
on `.rg-ask-*` or `.rg-gal-lightbox`. Ordering between these surfaces is now **opening order**, not
a number.

**How to migrate.** Remove the `z-index` rules. If a host surface has to sit above one of these, it
must be in the top layer as well (`popover`, or its own `showModal()`); no number can get there.

#### 3. The toast stack is a `popover="manual"` and is re-parented while a dialog is open

**What.** `.rg-toast-stack` carries `popover="manual"` and is adopted into whichever top-layer host
is showing, rather than living permanently as a `<body>` child at `z-index: 2147483000`. A toast
left under an open modal was measured *visible but dead* — `showModal()` makes every non-descendant
inert, and error toasts have `duration: 0`, so the user could not dismiss them.

**Who breaks.** Selectors anchored to its old parent (`body > .rg-toast-stack`) and any `z-index`
rule on it. `document.querySelector('.rg-toast-stack')` still works.

**How to migrate.** Anchor by class, not by parent; drop the `z-index`.

#### 4. `RaptorSidebar`: `popover`, a scrim child, new attributes, and a new mode enum

**What.**

- The rail carries `popover="auto"` unconditionally, at every width. Open/closed is
  `:popover-open`; Esc, light-dismiss and focus return come from the user agent.
- A new **first child**, `<div class="rg-sidebar-scrim" aria-hidden="true">`, is rendered at every
  width (inert above 992px). It is a real element rather than the popover's `::backdrop` because
  `pointer-events` is not author-settable on a popover backdrop — measured, `!important` at (0,3,1)
  still computed `none`, so a tap beside an open rail fell through to the page and was measured
  closing the drawer *and* firing the `hx-confirm` Delete button it landed on.
- New `data-rg-sidebar-mode` and `data-rg-sidebar-desktop` attributes, on the rail itself. Nothing
  is written to the host's `<html>` element.
- The toggle button gained `data-rg-sidebar-rail-toggle`, `aria-controls` and `aria-expanded`.
- New `RaptorSidebarMode` enum with `MobileMode` (default `Drawer`) and `DesktopMode` (default
  `Docked`) parameters.
- With **both** bands `Off` the component renders no markup at all — previously it always rendered
  the `<aside>`.

**Who breaks.**

- A host with its own menu script that toggled an "open" class on the rail or a state attribute on
  `<html>`. It now fights the popover: the UA closes the rail on light-dismiss while the script
  still believes it is open.
- `.rg-sidebar > :first-child` and `:nth-child()` selectors — the scrim is now first.
- Host CSS keyed on the host's own open class instead of `:popover-open`.
- Code that assumed the `<aside id="…">` is always in the document.

**How to migrate.** Delete the vendored menu script. Open the rail with `popovertarget` on your
button or `showPopover()`; style the open state with `:popover-open`; select the brand block by its
own class. If you relied on the element always existing, keep at least one band non-`Off`.

#### 5. Dropdown and select panels no longer always portal to `<body>`

**What.** `portalTarget()` (`Client/src/core/dom.ts`) re-homes a floating panel per open: into
whichever top-layer host is currently showing — the rail, a page-chrome popover, an open dialog —
and back under `<body>` when none is. Previously it was always `<body>`.

Measured cause: with the rail open, a panel at `z-index: 500` parked under `<body>` painted *under*
the rail's `::backdrop` — in dark mode that scrim is `rgb(17 24 39 / .8)`, so the panel did not
vanish, it dimmed to an unreadable rectangle. A tap on it was also an *outside* tap for
light-dismiss, so the UA closed the rail out from under the still-open panel.

**Who breaks.**

- Selectors anchored to `<body>`: `body > .rg-dd-panel`, `body > .rg-select-panel`.
- **A new invariant for hosts.** A top-layer host must not carry `transform`, `filter`,
  `backdrop-filter`, `perspective`, `will-change` or `contain: paint`. The panel positions itself
  `position: fixed` in viewport coordinates; any of those makes the host a containing block and
  re-resolves them against its box — measured, adding a transform to the rail collapsed the sheet
  from 390px wide to 239px.

**How to migrate.** Anchor selectors by class. Audit your own `popover` / `dialog` wrappers for the
six properties above and move any of them onto an inner element.

#### 6. `Vary` header changed, and history-restore requests get the full layout

**What.** `HtmxLayout<T>` (`Composition/Layouts.cs`) now sends
`Vary: HX-Request, HX-History-Restore-Request` instead of `Vary: HX-Request`, and a request carrying
`HX-History-Restore-Request` gets the **full** layout despite also carrying `HX-Request` — htmx
extracts the `[hx-history-elt]` region out of a complete document itself, and a chromeless fragment
would replace the page region with no fixed chrome around it.

**Who breaks.** A CDN or reverse proxy holding entries keyed on the old `Vary` will serve a
chromeless fragment as a full page (or the reverse) until those entries expire. A host that made its
own layout decision from "is this an htmx request?" needs the same three-way split.

**How to migrate.** Invalidate the cache for boosted URLs at deploy. If you branch on `IsHtmx`
yourself, exclude `IsHistoryRestore`.

#### 7. `RaptorAppRoot` emits `hx-history-elt`

**What.** The wrapper renders `<div id="app-root" hx-history-elt>`. Without it htmx snapshots
`<body>`, so a Back re-created everything outside the swap region — fixed chrome, modal containers —
from a serialised copy.

**Who breaks.** A host that already placed `hx-history-elt` on a different element now has two, and
htmx uses the first in document order.

**One-time effect on upgrade.** Snapshots written by 0.1.x are body-scoped and would nest a whole
document inside the narrower region. `runtime/page-lifecycle.ts` therefore purges
`sessionStorage['htmx-history-cache']` once, on the first load of this build, keyed by
`rg-hist-schema = v2-app-root`. A tab open across the deploy loses its history cache once and
re-fetches; nothing else is touched.

**How to migrate.** Remove your own `hx-history-elt`.

#### 8. `htmxMode: 'auto'` defers its presence check to `DOMContentLoaded`

**What.** In `auto` mode the `window.htmx` check now runs at `DOMContentLoaded` instead of at module
evaluation.

**Why.** A consumer bundling its own htmx typically assigns `window.htmx` from a deferred module,
and whether that module evaluates before or after this one is a load-order accident — checking too
early injected a second copy alongside it.

**Who breaks.** A consumer that assigns `window.htmx` *after* `DOMContentLoaded` (a late dynamic
import) still gets a second copy, and now the library's own copy also lands later than before.

**How to migrate.** If you ship your own htmx, set `htmxMode: 'never'` and stop relying on
detection.

#### 9. The grid's card-mode filter drawer, its FAB and `RaptorFilterPanel` are top-layer, and all three grew an element

**What.** The last three `position: fixed` surfaces this library rendered in the normal layer moved
into the top layer, and two of them changed shape to get there.

- `.rg-filter-drawer` carries `popover="auto"` and is now a **full-viewport shell that never moves**.
  The scrim `.rg-filter-backdrop` became its **first child**, and a new `.rg-filter-panel` is the
  surface that slides. Previously the drawer *was* the sliding surface.
- `.rf-panel` (`RaptorFilterPanel`) took the same shape: `popover="auto"` shell, `.rf-backdrop` as a
  child, and a new `.rf-sheet` carrying the slide. Previously `.rf-panel` was the sheet.
- `.rg-filter-fab` carries `popover="manual"` and `MobileFilterDrawer` shows it at mount. It is
  `manual` rather than `auto` because an `auto` FAB is light-dismissed by the first tap anywhere and
  closes when the drawer — itself `auto` — opens.
- The slide is one level in, on the panel/sheet, so the shell stays transform-free and its scrim can
  stay a plain `position: fixed; inset: 0`. A transform on the shell would make the shell a
  containing block for its own fixed scrim.

**Why.** The `translate` that `RaptorSidebarMode.Push` puts on the content column makes that column
the containing block for every ordinary fixed descendant. Measured at 500×667, `.rg-sidebar-pushed`
translated 240px: the drawer shell, its scrim and its panel are now `[0,0,500,667]`,
`[0,0,500,667]` and `[140,0,360,667]` — **identical to the un-pushed values**, where the pre-change
drawer went `[140,0,360,723] → [375,56,360,2519]` and stopped covering both the top bar and the
leading 240px. The FAB is the one that did not need to be *opened* to break: measured across 146
animation frames of a rail opening, its `y` is a single value (`663`) from the first frame to the
last, where it used to drop 56px in one frame before any horizontal movement began. Escape is the
user agent's now — before, a real Escape left the drawer up with `body { overflow: hidden }` still
held, because nothing listened for a key at all.

**Who breaks.**

- Host CSS giving `.rg-filter-drawer` or `.rf-panel` a width, an inset, a transform or a shadow. Both
  are full-viewport shells now: `width: 360px` there sizes the shell, not the surface the user sees.
- Host CSS or script driving the open state through a class, `style.display` or `hidden`. The state
  is `:popover-open`; only `showPopover()` / `hidePopover()` move these elements in and out of the
  top layer.
- `z-index` on any of the three, including through `--rg-z-drawer`. It is reachable only inside the
  Safari-26 exit window, where `overlay` is unsupported.
- Selectors that assumed `.rg-filter-backdrop` / `.rf-backdrop` is a **sibling** of the drawer/panel,
  or that `.rg-filter-drawer > *` is filter content.
- A host that opened one of these surfaces and *also* opens its own `popover="auto"`: two `auto`
  popovers that are not nested cannot both be open, so showing the rail now light-dismisses an open
  filter drawer (measured). That is the user agent's rule, and it is what makes the pushed-geometry
  case unreachable rather than merely unlikely.

**How to migrate.** Move geometry and painting rules from `.rg-filter-drawer` to `.rg-filter-panel`
and from `.rf-panel` to `.rf-sheet`; style the open state with `:popover-open`; open and close with
the popover API; delete the `z-index` rules.

**One caveat that is not a migration step.** Between first paint and the grid chunk mounting — and
permanently on an engine without the popover API — the FAB is still an ordinary fixed descendant and
the pushed column still moves it. `_sidebar.scss` §4b gates the FAB's own compensating `translate` on
`:popover-open` for exactly that reason; measured, the compensation reads `none` in the degraded
state, so the FAB is translated once and never twice.

#### 10. The dropdown/select backdrop paints on `::before`, and both panels moved z-index band

Two separate changes to `styles/forms/_select.scss`, both invisible until a host has its own rule.

`.rg-dd-backdrop` no longer carries `background: rgb(0 0 0 / .45)` on the element. The paint moved to
`&::before`, because Safari 26 samples a `position: fixed` element's *own* background to tint the
status bar, and a full-height backdrop touching the top edge was tinting it. A host that restyled the
scrim with `.rg-dd-backdrop { background: … }` now changes nothing — the declaration still applies,
but the visible surface is the pseudo-element above it.

**Migration:** target `.rg-dd-backdrop::before` instead. Overriding the element's `background` is
inert, not an error, so this fails silently.

The panels also left the ad-hoc band they were in: `.rg-select-panel` / `.rg-dd-panel` went from
`z-index: 90` to `var(--rg-z-popover)` (500) and the backdrop from `89` to `490`. A host with a
normal-layer surface anywhere in 100–400 used to cover these panels and now sits underneath them.

**Migration:** if a host surface must stay above an open dropdown, raise it above 500, or — better —
put it in the top layer, which is where everything else in this release went. Note this band only
matters while the panel is in the normal layer: when it is re-homed into an open top-layer host
(breaking change 5) the band stops mattering entirely and top-layer order decides.

---

### Added

- **`RaptorPageChrome`, `RaptorPageAction`, `RaptorPageChromeOutlet`** (`Layout/`) — a page shell
  that renders the title, an optional back link, a description and page-level actions, and projects
  the title into the host's persistent mobile bar through a `SectionOutlet`. `RaptorPageChrome`
  publishes its contract as constants (`TopbarSectionName`, `TopbarPayloadElementId`,
  `TopbarDetailElementId`, `TopbarDetailTitleElementId`) so no consumer hand-writes the ids.
  Placing the outlet is optional: the projector no-ops when it is absent and the in-page heading
  stays visible.
- **`PageActionEmphasis`** enum (`None` / `Primary` / `Success`) — a *request*, not a promise: the
  shell decides whether an action paints inline beside the title or as a row inside the "…" menu,
  and inside a menu the emphasis is flattened away.
- **`RaptorSidebarMode`** enum (`Drawer` / `Push` / `Rail` / `Docked` / `Off`) with the `MobileMode`
  and `DesktopMode` parameters described above. Open/closed is deliberately *not* part of the enum.

  **`Push` does nothing until the host opts three of its own elements in.** This library cannot know
  a consumer's class names, so it moves only what it is told to move. Setting `MobileMode="Push"`
  and nothing else is a no-op — the drawer opens and the page stays put. The three marks are
  separate responsibilities, defined in `styles/layout/_sidebar.scss`:

  | class | put it on | what it does |
  | --- | --- | --- |
  | `rg-sidebar-pushed` | the content column | takes the `translate` while the rail is open |
  | `rg-sidebar-pushed-chrome` | fixed chrome *outside* the content column (top bar, its glass layer, a hamburger FAB) | takes the same `translate`, same duration and easing, so the frame moves as one piece |
  | `rg-sidebar-pushclip` | the frame that should clip the overflow | `overflow-x: clip` |

  Chrome usually lives outside the routed region so it survives boosted swaps, which is exactly why
  it needs its own mark rather than inheriting one. Mark the content column but not the chrome and
  the bar stays behind while the page slides out from under it.
- **`RaptorGridFilterEntry`** enum (`Fab` / `PageChrome`) and the **`RaptorGridFilterButton`**
  component, plus a `FilterEntry` parameter on `RaptorGrid`, `RaptorGridRegion`, `GridView<T>` and
  `GridViewModel`, and a `data-rg-filter-entry` mark on the grid region. `PageChrome` moves the
  card-mode filter drawer's *opener* into the page's "…" menu by declaration; the drawer and the FAB
  are never re-parented, because the region replaces its own `outerHTML` on every page or filter
  change and a lifted-out node would leave a stale duplicate behind. The FAB is hidden, not removed:
  when the promised menu entry is not in the document a client-side assertion takes the mark back
  off and the FAB reappears in the same frame.
- **A published `:root` token block** (`Client/src/styles/_tokens.scss`):
  - `--rg-z-*` — the canonical z-index scale, now stated in the stylesheet rather than only in
    comments. **It orders the normal layer only** (see the note under *Historical* below).
  - `--rg-tap-min: 44px` and `--rg-tap-min-tight: 40px` — the touch-target floor, published so a
    host can size its own controls off the same number, or raise it for a kiosk build, without
    rebuilding the package. **This library also enforces it** — see *Changed* below; the token is
    not documentation, it is the number the enforcement reads.
  - `--rg-scrim` — the drawer/overlay scrim colour, `rgb(17 24 39 / .5)` in the light theme and
    `rgb(17 24 39 / .8)` in the dark one (`styles/themes/_light.scss`, `_dark.scss`). Both are
    written as `var(--sp-scrim, …)`, so a host can retint every scrim by declaring `--sp-scrim`
    without overriding the rule. Read by the sidebar's scrim child.
  - `--rg-scroll-gutter` — the width the page scroll lock had to take away, published on `<html>`
    while a lock is held and `0px` otherwise. See *Fixed* below.
- New localization keys: `Grid_ColumnFilters`, `Grid_OpenColumnFilters`, `PageChrome_Actions`,
  `PageChrome_Back` (English and Turkish).

### Changed

- **The touch-target floor is now enforced, not just published.** `--rg-tap-min` used to be a number
  a host could read; this release makes the library apply it. Under
  `(hover: none) and (pointer: coarse), (max-width: 991.98px)` the token is read 36 times and at
  least 26 classes get a `min-height`/`min-width` from it, including `.rg-btn`, `.rg-btn-icon`,
  `.rg-check`, `.rg-switch`,
  `.rg-input`, `.rg-file`, `.rg-permrow`, `.rg-actions-trigger`, `.rg-dd-item`, `.rg-actions-item`,
  `.rg-select-option`, `.rg-select-button`, `.rg-select-search`, `.rg-dd-search`, `.rg-sort`,
  `.rg-funnel`, `.rg-nav`, `.rg-select`, `.rg-selbar-clear`, `.rg-expand`, `.rg-pop-check`,
  `.rg-pop-input`, `.rg-pop-clear`, `.rg-filter-x`, `.rg-filter-fab`, `.rg-filter-done` — and the
  grid's `.rg-foot` bottom padding is recomputed from the same number. `styles/forms/_form.scss`
  states that this deliberately outranks a host's own `!important` padding.

  This is a **visible layout change on every phone and every narrow window**: controls that were
  under 44px grow, and rows built around their old height reflow. It is not opt-in and there is no
  flag to disable it. A host that needs a different floor sets `--rg-tap-min` (and
  `--rg-tap-min-tight`) rather than fighting the rules; setting it *lower* than 44px is allowed but
  is the point at which the library stops meeting the platform guidance it was added for.

- **The iOS zoom guard overrides the host's font size on form controls.** Under
  `(hover: none) and (pointer: coarse)`, `.rg-input`, `.rg-textarea`, `.rg-select-button`,
  `.rg-select-search` and `.rg-dd-search` are forced to `font-size: 1rem`
  (`styles/forms/_form.scss`, `styles/forms/_select.scss`). Mobile Safari zooms the page when a
  focused field computes under 16px, and that zoom does not reverse on blur; the only way to prevent
  it is for the field itself not to be smaller.

  A consumer using deliberately smaller typography on phones **loses it on these five controls**, and
  loses it silently. Keeping smaller text means accepting the zoom — the two cannot both be had.

- `modal-container` is now a **placement** detail rather than a correctness one. It existed because
  `applyInertBelow()` walked `document.body.children`, so a second container would have gone inert
  the moment a dialog opened in the first. That pass is gone; the UA scopes inertness to the
  dialog's own subtree. A top-layer dialog also resolves against the viewport wherever it sits —
  measured `{0, 781, 390, 63}` from five levels inside a 240px push under `overflow-x: clip`, and
  unchanged again after the push became a `translate`. The container is kept only because one
  predictable host is easier to reason about than several.
- The `rg-` prefix rule in `_tokens.scss` is unchanged in effect, but its rationale is no longer
  "panels are portalled to `<body>`" — they are re-homed per open, so there is no single ancestor an
  ancestry-keyed rule could use. The prefix test does not care where they are. `README.md` is
  updated to match.

### Fixed

- `resetScrollLock()` left `overflow: hidden` stuck on `<body>`. It set `depth = 0` and then called
  `unlockScroll()`, whose first statement is `if (depth === 0) return` — so the restore never ran.
  It now collapses the count to 1 and releases through the ordinary path.
- `lockScroll()` clamps the measured scrollbar gap at `0`, so a negative measurement cannot subtract
  padding from `<body>`.
- **Viewport-pinned surfaces jumped sideways when a lock was taken.** Hiding a classic scrollbar
  *widens the viewport*, which is the containing block of every `position: fixed` box, top layer
  included; the `padding-right` compensation on `<body>` answers for normal-flow content and nothing
  else. Measured (Chrome 150, `::-webkit-scrollbar { width: 5px }`): `clientWidth` went 1795 → 1800
  when a modal took the lock, and the toast stack moved x 1459 → 1464 while the user was reading it.
  The gap is now also published as `--rg-scroll-gutter` and subtracted by the surfaces that resolve
  against the viewport. `scrollbar-gutter: stable` was measured and rejected — the reserved gutter is
  dropped along with the scrollbar, on `<body>` *and* on `<html>`.

### Historical — declared but no longer read by this library

`--rg-z-modal` (400), `--rg-z-toast` (600) and `--rg-z-confirm` (700) are **declared in `:root` and
read by zero `var()` in the compiled bundle** — verified against
`wwwroot/dist/raptor.<hash>.css`. Their surfaces are in the top layer now, where no number applies.
The same is true of `--rg-z-canvas`, `--rg-z-sticky`, `--rg-z-nav` and `--rg-z-debug`, which this
library has never painted with; only `--rg-z-chrome`, `--rg-z-drawer` and `--rg-z-popover` are live.

**Decision: the declarations stay, and each line now says which of the three it is.** Removing them
was considered and rejected for two reasons. Consumers read these tokens for their *own* normal-layer
surfaces — with a literal fallback, `var(--rg-z-modal, 400)` — so deleting the declaration would
silently swap them onto a hardcoded copy of the number and lose the single source of truth for the
scale. And the numbers still answer a real question: where a host should put a surface of its own
that has to sit near one of ours *in the normal layer*.

**What is not true, and is why the markers were added:** overriding `--rg-z-modal`,
`--rg-z-toast` or `--rg-z-confirm` moves nothing this library renders. If you need to sit above one
of those surfaces, put yours in the top layer too.

[Unreleased]: https://github.com/RaptorTwentyOne/Raptor21.RCL/compare/v0.2.0-preview.1...HEAD
[0.2.0-preview.1]: https://github.com/RaptorTwentyOne/Raptor21.RCL/releases/tag/v0.2.0-preview.1
