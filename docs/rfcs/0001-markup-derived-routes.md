# RFC 0001 — Markup-derived routes and instance identity

Status: **draft** · Builds on: `RaptorRoutesGenerator` (0.3.0-preview.2)

## Vision (the consumer's words, paraphrased)

> Imagine placing a modal anywhere in the system: it should get its own route automatically, overridable if
> the user wants, and reachable from code through a property — `<RaptorModal Id="TestModal"/>` in markup,
> `TestModal.Url` in the code-behind. The library should resolve what the code is trying to do.

`Routes` (shipped — deliberately unbranded, since it lives in host markup; renameable per project via the
`RaptorRoutesClassName` MSBuild property) solved the *attribute* half: every `[RaptorPage]`/`[RaptorComponent]`
class already gets compile-time URL accessors. This RFC covers the two remaining steps: routes that exist **without** being
written, and identity attached to a **markup instance** rather than a class.

## Part 1 — Convention auto-routes (small, do first)

`[RaptorComponent]` (and `[RaptorPage]`) gain a parameterless constructor. A class carrying the bare
attribute gets a convention route derived from its type name:

```
PageGroupModal      →  /components/page-group-modal
CustomerQuickPanel  →  /components/customer-quick-panel
```

One rule, no exceptions: kebab-case of the full class name under a single `/components/` prefix (no suffix
stripping, no per-kind prefixes — guessing intent from a name suffix is where conventions rot). An explicit
route argument overrides, exactly as today.

Implementation notes:

* The kebab-case rule lives twice — runtime scanner (`RaptorPageEndpoints`) and generator — because a
  netstandard2.0 analyzer cannot reference the net10.0 library. Guard with a parity test in the (future)
  test project: same inputs, both implementations, identical output.
* `Routes` emission is unchanged: the convention route simply becomes the `Base` const, so consumers
  never write the derived string either.

## Part 2 — Markup instance identity (the real design question)

### What the generator can see

The generator today reads only the C# compilation. To see `<RaptorModal Id="TestModal"/>` it needs the
`.razor` sources as `AdditionalFiles`: the package's `buildTransitive/Raptor21.RCL.props` adds
`<AdditionalFiles Include="**/*.razor" />`, and the generator does a lightweight scan (regex/tag-level, not
a Razor parse) for Raptor component elements carrying `Id="..."`. From that it can emit, per instance:

```csharp
// Raptor21.RCL.Generated
public static class TestModal
{
    public const string Url = "...";   // what, exactly? — see below
}
```

### What should `TestModal.Url` render?

This is the open question. Three candidate semantics:

**(a) Declarative fragment endpoint.** `Url` is a real GET endpoint that renders the modal's subtree —
`hx-get` it, swap into `#modal-host`, done. Honest constraint: the subtree must be *renderable out of the
enclosing page's render context*. That is only mechanical when the Id'd modal wraps a single self-contained
component (`<RaptorModal Id="X"><UserForm UserId="..."/></RaptorModal>` → endpoint renders `RaptorModal` +
`UserForm`, query string → component parameters). Arbitrary inline markup capturing page locals cannot be
lifted to an endpoint, and pretending otherwise would fail at runtime, unpredictably. Requires the Phase B
descriptor registration (generated endpoints need a public registration API anyway).

**(b) Anchor semantics.** `Url` is the enclosing page's URL plus `?raptor-open=TestModal`; the RCL client
auto-opens the named modal after load. Trivial to build, zero new endpoint machinery, works for any markup —
but it is *navigation*, not a fragment fetch, so it answers deep-linking rather than the code-behind
"post to/open this instance" scenario the vision describes.

**(c) Alias-only.** `Id` just names an instance of an already-`[RaptorComponent]`-routed class; `TestModal.Url`
is sugar over `Routes.<Class>.Get(...)` with the instance's literal attribute values baked in as
defaults.

**Recommendation:** ship (b) first — it is small, universally applicable, and immediately useful for
deep-linking modals; then implement (a) for the constrained single-component shape on top of Phase B, with a
generator *diagnostic* (not silent fallback) when an Id'd modal's subtree is not liftable. (c) falls out of
(a)'s analysis almost for free and can piggyback on it.

## Sequencing

1. ✅ Part 1 (parameterless attribute ctor + convention rule + parity test) — shipped: `RaptorRouteConvention`,
   its generator copy, and `RouteConventionParityTests`.
2. Part 2(b) anchor semantics: client `?raptor-open` handling + generator emission from AdditionalFiles.
3. Phase B descriptor registration (prerequisite for 2(a); wanted for reflection-free startup regardless).
4. Part 2(a) declarative fragment endpoints for the single-component shape, with diagnostics.
