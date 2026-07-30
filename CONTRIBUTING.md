# Contributing

## Repository conventions (RaptorTwentyOne)

Public and private repositories live side by side in this organisation, so a repository has to state
plainly which one it is. Naming alone cannot: `Raptor21.Framework` is private and `Raptor21.RCL` is public,
and they read identically.

**Every public repository in this organisation carries all four of these.** Their absence is the signal
that a repository is not meant to be public — check before you push.

| Marker | Why it, specifically |
|---|---|
| `LICENSE` at the root | The only one with legal force. No licence means all rights reserved, whatever the visibility flag says. |
| This `CONTRIBUTING.md` | Names the convention, so the rule travels with the repository instead of living in someone's head. |
| The `open-source` GitHub topic | The only marker that is queryable: `org:RaptorTwentyOne topic:open-source` lists exactly the public set. |
| A CI workflow that packs/publishes | A repository nobody publishes from is not really a product. |

A private repository must have **none** of them. If you are adding a repository and unsure, keep it private:
making a repository public is easy, un-publishing a git history is not.

## Building

```bash
dotnet build Raptor21.slnx
```

Node is not required to build or pack. `src/Raptor21.RCL/wwwroot/dist` is committed on purpose so a
.NET-only contributor can work without it, and the assembly embeds that bundle.

## Changing the client (TypeScript / SCSS)

```bash
cd src/Raptor21.RCL/Client
npm ci
npm run typecheck
npm run build          # rewrites ../wwwroot/dist — COMMIT the result
```

**The rebuilt `dist` must be committed with the change that caused it.** A `.NET`-only build does not
regenerate it, so an uncommitted bundle means every consumer who builds without Node silently gets the old
behaviour — a difference that appears in no diff. CI enforces this: it rebuilds from `Client/src` with
`-p:RaptorBuildClient=true` and fails if the committed `dist` differs.

## Releasing

The tag is the version. `dotnet pack` reads it, so no number is edited by hand:

```bash
git tag v0.2.0
git push --tags
```

`.github/workflows/release.yml` then builds, packs and pushes to nuget.org using the `NUGET_API_KEY`
secret, and attaches the packages to a GitHub release.

## Third-party code

`src/Raptor21.RCL/Charts/Models` and `Charts/Serialization` are ported from
[Blazor-ApexCharts](https://github.com/apexcharts/Blazor-ApexCharts) (MIT). See `THIRD-PARTY-NOTICES.txt`,
which ships inside the NuGet package as well as living here — MIT requires the notice to travel with the
distribution, not just with the source.
