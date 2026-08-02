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

## Three things to know before you build on it

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

## Building from source

The client bundle is built with rspack and committed under `wwwroot/dist`, so a .NET-only contributor never
needs Node installed. If you change anything under `Client/src`, rebuild it:

```bash
cd Client && npm ci && npm run build
```

The build warns when `wwwroot/dist` is older than `Client/src`, and fails outright when the bundle is
missing. CI regenerates it with `-p:RaptorBuildClient=true`.

## Licence

MIT.
