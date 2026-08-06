using Microsoft.AspNetCore.Components;

namespace Raptor21.RCL.Rendering;

/// <summary>
/// A component whose whole lifecycle (<c>OnInitialized*</c> / <c>OnParametersSet*</c>) runs under the
/// request's <see cref="RaptorRenderGate"/>, serializing it with every other gated component in the same
/// request.
/// <para>
/// Blazor Static SSR starts sibling components' async initializers concurrently, so a layout, a page and
/// its child components all reach the single request scope at the same time. Scoped services that are not
/// safe for concurrent use — a database connection or an ORM context resolved per request — see overlapping
/// calls. Deriving the data-loading components from this base makes those calls sequential at the component
/// layer, without every scoped service having to defend against concurrency itself.
/// </para>
/// <para>
/// <see cref="ComponentBase.SetParametersAsync"/> never awaits child lifecycles (the renderer tracks
/// children separately for quiescence), so a gate holder's progress can never depend on a gate waiter and
/// circular waits are structurally impossible for well-formed components. The gate still carries a timeout
/// naming the component, so an unforeseen cycle throws instead of hanging.
/// </para>
/// <para>
/// On a request that renders a single gated component the gate is uncontended. On a full page the gated
/// data phases run one after another, so total latency is their sum rather than their maximum.
/// </para>
/// </summary>
public abstract class RaptorSequentialComponent : ComponentBase
{
    [Inject]
    private RaptorRenderGate Gate { get; set; } = default!;

    /// <summary>
    /// Materializes <paramref name="parameters"/>, acquires the request's gate, and runs the base lifecycle
    /// under it.
    /// <para>
    /// A <see cref="ParameterView"/> reads the renderer's live buffer and expires at the first await, so it
    /// is copied before the gate is awaited and replayed afterwards. The copy flattens the cascading flag,
    /// so a derived component must not declare a <see cref="CascadingParameterAttribute"/>; binding one
    /// throws rather than binding silently.
    /// </para>
    /// <para>
    /// The lifecycle is already exclusive while it runs — its data access needs no further wrapping. Do
    /// not call <see cref="RaptorRenderGate.RunExclusiveAsync{T}"/> (or another acquiring seam) from a
    /// derived lifecycle: the gate is deliberately non-reentrant and the nested acquisition would time
    /// out. The one library-internal nesting — the grid region invoking the grid builder — goes through
    /// the builder's internal non-acquiring entry instead.
    /// </para>
    /// </summary>
    public override Task SetParametersAsync(ParameterView parameters)
    {
        var copied = ParameterView.FromDictionary((IDictionary<string, object?>)parameters.ToDictionary());
        return Gate.RunLifecycleAsync(GetType(), () => base.SetParametersAsync(copied));
    }
}
