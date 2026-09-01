# Raptor21.RCL

Server-rendered grid, filter, form and dialog components for ASP.NET Core, driven by htmx. Blazor Static
SSR — no interactive circuit, no WebSocket, no client-side framework to adopt.

> **0.x.** Nothing is published as stable yet and the public surface is still wide, so treat any release in
> this range as "anything may change". Pin an exact version.

## Install

```bash
dotnet add package Raptor21.RCL
```

```csharp
builder.Services.AddRaptor21();
```

That is the whole integration. There is no `UseRaptor21()` to forget: the middleware that serves the client
bundle installs itself through an `IStartupFilter`.

An application shell and a default layout are configured on the same call:

```csharp
builder.Services.AddRaptor21(o =>
{
    o.RootComponent = typeof(HtmxApp<AppShell>);   // the full-page html/body shell
    o.DefaultLayout = typeof(MainLayout);          // layout for pages without [Layout]
});
```

Then place the two asset components in your root layout — the stylesheet in `<head>`, the script at the end
of `<body>`:

```razor
<head>
    <RaptorStyles/>
</head>
<body>
    @Body
    <RaptorScripts/>
</body>
```

## How the client bundle is delivered

The JavaScript and CSS are **embedded in the assembly** and served from `/_raptor21/<content-hash>`, not
copied into your `wwwroot`. Installing the package is therefore the entire integration: there is no file to
publish, no static-web-assets step to go wrong, and no way for your copy to drift from the version you
reference. Filenames are content-hashed, so responses are immutable and cache forever.

If the package is ever built without its bundle, the application **refuses to start** with an explanatory
error rather than serving pages with no stylesheet and dead htmx.

## Four things to know before you build on it

**1. This library owns the `rg-` class prefix.** Do not use it for your own classes.

The stylesheet contains a prefix-keyed rule:

```css
[class^='rg-'][hidden], [class*=' rg-'][hidden] { display: none !important; }
```

It is prefix-keyed rather than ancestry-keyed on purpose: dropdown and select panels are portalled out of
their own wrapper to escape clipping, and there is no one ancestor they land under — they are re-homed per
open, into whichever top-layer host is showing and back to `<body>` when none is. A rule scoped by ancestor
would therefore reach them in some states and not others, and where it did not they would stay on screen
while the component believed they were closed — a silent failure where the next Escape key closes the
dialog behind them instead. The trade-off is that any element of yours whose class starts with `rg-` is
inside this library's namespace.

**2. Markup this library renders carries its own CSS-isolation scope, not yours.**

A class you pass to a component (`<RaptorChart Class="my-sizing"/>`) lands on markup rendered *by the
component*, so a rule written in your page's `.razor.scss` — scoped to your page's generated attribute —
will never match it. It does not look broken; it silently does nothing. Keep your sizing class on your own
element and let the component fill it:

```razor
<div class="my-sizing">
    <RaptorChart Id="sales" Class="rg-chart--fill"/>
</div>
```

**3. Every overlay this library opens is in the browser's top layer, so `z-index` cannot reach it.**

Modals, the confirm dialog, the progress dialog and the gallery lightbox are native `<dialog>` opened with
`showModal()`; the sidebar rail, the page-chrome menus and the toast stack are native popovers. The top
layer paints above the entire normal layer whatever number anything down there carries — measured, a
`<body>` child at `z-index: 2147483647` was still returned *underneath* an open rail by
`elementsFromPoint`.

Two consequences for your stylesheet:

- A `z-index` you set on `.rg-modal`, `.rg-toast-stack` or the confirm does nothing. Neither does raising
  `--rg-z-modal`, `--rg-z-toast` or `--rg-z-confirm`; those tokens are historical and are read by nothing
  in the bundle. Surfaces in the top layer are ordered against each other by **opening order**. If yours
  has to sit above one of ours, it has to be in the top layer too.
- If you host one of our panels — that is, if you render your own `popover` or `<dialog>` that a dropdown
  or select can open inside — it must not carry `transform`, `filter`, `backdrop-filter`, `perspective`,
  `will-change` or `contain: paint`. Each of those makes your element a containing block for the panel's
  `position: fixed`, and the panel is then laid out against your box instead of the viewport. Measured: a
  transform on the rail collapsed a sheet from 390px wide to 239px. Move the property to an inner element.

**4. The library never runs two of your data callbacks in parallel in one request — put your own
data-loading components under the same guarantee.**

Blazor Static SSR starts sibling components' async initializers concurrently: a layout, a page and every
component on it reach the request's single DI scope at the same time, so a scoped `DbConnection` or ORM
context sees overlapping calls. This library serializes everything *it* invokes: a grid's whole data phase
(permission check, set options, page fetch) runs as one exclusive section under a per-request
`RaptorRenderGate`, and every `RaptorPage` / `RaptorRoutableComponent` / grid-region lifecycle queues on
that same gate.

A component of yours that loads data in its lifecycle joins the guarantee one of two ways:

```razor
@inherits Raptor21.RCL.Rendering.RaptorSequentialComponent   @* whole lifecycle under the gate *@
```

or, where the base class does not fit (it forbids `[CascadingParameter]`):

```csharp
[Inject] private RaptorRenderGate Gate { get; set; } = default!;

protected override Task OnInitializedAsync() =>
    Gate.RunExclusiveAsync(GetType(), async () => { _model = await LoadAsync(); });
```

One rule: **code already under the gate never calls an acquiring seam again.** A
`RaptorSequentialComponent` lifecycle is already exclusive — calling `RunExclusiveAsync` (or
`RaptorGridBuilder.PrepareAsync`, which acquires the same gate) from inside one nests acquisitions on a
deliberately non-reentrant gate and fails after a 60-second timeout with an exception naming the offender.
The same applies inside a `RunExclusiveAsync` delegate. The gate refuses reentrancy on purpose: ambient state cannot distinguish a
directly-awaited nested call from a flow the renderer forked under the holder's context, and an inference
that guesses wrong there silently un-serializes the exact work the gate exists to serialize.

With every data-loading component gated, **one plain scoped connection per request is safe by
construction** — no connection-per-operation pooling, no serializing wrappers in the host. Parallelism
belongs to the HTTP layer, where ASP.NET Core already gives one scope per request: each deferred grid load
(grids defer by default), filter post and modal fetch is its own request with its own scope and its own
connection.

## Building from source

The client bundle (`wwwroot/dist`) is a build output and is not committed. Node 22 is a prerequisite: the
first `dotnet build` of a fresh clone runs `npm ci && npm run build` in `Client/` by itself (the manifest is
missing, so `RaptorBuildClient` defaults to `true`). After that an ordinary `dotnet build` reuses the bundle
and warns when `Client/src` is newer; rebuild it with

```bash
cd Client && npm run build
```

or build with `-p:RaptorBuildClient=true`, which is what CI and the release always do. The build fails
outright when no bundle exists, so a package without its stylesheet and script cannot be produced.

## Licence

MIT.
