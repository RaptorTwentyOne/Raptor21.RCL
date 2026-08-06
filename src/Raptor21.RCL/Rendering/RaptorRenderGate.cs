namespace Raptor21.RCL.Rendering;

/// <summary>
/// The per-request render gate: it enforces "one request, one scope, sequential data access" under Blazor
/// Static SSR. No two pieces of gated work ever overlap within one request scope — which is what lets a
/// host share a single scoped database connection across everything a page render touches.
/// <para>
/// Registered <c>Scoped</c>, giving one gate per request, so gated work serializes within a request and
/// never across requests. Every independently-loading fragment (a deferred grid's POST, a filter POST, a
/// modal GET) is its own HTTP request, so cross-fragment parallelism stays at the HTTP layer where each
/// request already has its own scope and connection.
/// </para>
/// <para>
/// Every acquisition queues — deliberately, there is NO reentrancy. Ambient state (an
/// <see cref="AsyncLocal{T}"/> marker) cannot distinguish "directly awaited by the current holder" from
/// "forked under the holder's <c>ExecutionContext</c> but never awaited by it": the renderer starts child
/// components synchronously inside the holder's render pass, so any ambient marker leaks into flows whose
/// async work outlives the hold, and inline-on-marker designs let exactly the work this gate exists to
/// serialize escape it. Queuing is always correct for a forked flow, and the one legitimate nesting in
/// this library — the grid region's lifecycle invoking the grid builder — is resolved by explicit
/// declaration instead (the region calls the builder's internal, non-acquiring entry, because as a
/// <see cref="RaptorSequentialComponent"/> it knows it already holds the gate).
/// </para>
/// <para>
/// The corollary contract: code that already holds the gate must not call an acquiring API again.
/// A <see cref="RaptorSequentialComponent"/> lifecycle is already exclusive — its data access needs no
/// further wrapping, and a nested <see cref="RunExclusiveAsync{T}"/> from it would self-deadlock. That
/// misuse does not hang the request: the wait carries a timeout and throws an exception naming the waiting
/// owner. Circular waits are otherwise structurally impossible for well-formed components (a parent never
/// awaits child lifecycles — the renderer tracks them separately for quiescence — so a holder's progress
/// cannot depend on a waiter).
/// </para>
/// </summary>
public sealed class RaptorRenderGate : IDisposable
{
    private static readonly TimeSpan AcquireTimeout = TimeSpan.FromSeconds(60);

    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <summary>
    /// Runs <paramref name="work"/> under the request's gate: no other gated work overlaps it in this
    /// scope. Always queues for its own turn. This is the seam a consumer wraps a data phase in when the
    /// component cannot derive <see cref="RaptorSequentialComponent"/> — and it must be called from a
    /// context that does NOT already hold the gate (see the type remarks).
    /// </summary>
    public async Task<T> RunExclusiveAsync<T>(Type owner, Func<Task<T>> work)
    {
        ArgumentNullException.ThrowIfNull(work);

        await AcquireAsync(owner);
        try
        {
            return await work();
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc cref="RunExclusiveAsync{T}"/>
    public async Task RunExclusiveAsync(Type owner, Func<Task> work)
    {
        ArgumentNullException.ThrowIfNull(work);

        await AcquireAsync(owner);
        try
        {
            await work();
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// The component seam behind <see cref="RaptorSequentialComponent"/>: identical semantics to
    /// <see cref="RunExclusiveAsync(Type, Func{Task})"/>, kept as its own entry so the two seams read
    /// distinctly at the call sites.
    /// </summary>
    internal Task RunLifecycleAsync(Type componentType, Func<Task> lifecycle) =>
        RunExclusiveAsync(componentType, lifecycle);

    /// <summary>No <c>ConfigureAwait(false)</c>: gated work must resume on the renderer's
    /// synchronization context, because component lifecycles run through here.</summary>
    private async Task AcquireAsync(Type owner)
    {
        if (!await _gate.WaitAsync(AcquireTimeout))
            throw new InvalidOperationException(
                $"RaptorRenderGate not acquired within {AcquireTimeout.TotalSeconds:0}s for " +
                $"'{owner.Name}'. Either the gate holder's work awaits something that itself queues on the " +
                "gate (call gated seams only from contexts that do not already hold it — a " +
                "RaptorSequentialComponent lifecycle is already exclusive), or a holder's data phase is " +
                "genuinely slower than the timeout.");
    }

    public void Dispose() => _gate.Dispose();
}
