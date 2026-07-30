namespace Raptor21.RCL.Rendering;

/// <summary>
/// The per-request render gate behind <see cref="RaptorSequentialComponent"/>: it enforces "one request, one
/// scope, sequential data access" under Blazor Static SSR.
/// <para>
/// Register it <c>Scoped</c>, giving one gate per request, so gated components serialize within a request and
/// never across requests. A request that renders a single gated component acquires an uncontended semaphore.
/// </para>
/// <para>
/// The wait carries a timeout and reports the component that was waiting. Circular waits are structurally
/// impossible for well-formed components (see <see cref="RaptorSequentialComponent"/>), so exceeding the
/// timeout means a component's lifecycle awaited work that itself needs the gate; that throws instead of
/// hanging the request.
/// </para>
/// </summary>
public sealed class RaptorRenderGate : IDisposable
{
    private static readonly TimeSpan AcquireTimeout = TimeSpan.FromSeconds(60);

    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <summary>Acquires the request's render gate for <paramref name="componentType"/>'s lifecycle.</summary>
    public async Task WaitAsync(Type componentType)
    {
        if (!await _gate.WaitAsync(AcquireTimeout).ConfigureAwait(false))
            throw new InvalidOperationException(
                $"RaptorRenderGate not acquired within {AcquireTimeout.TotalSeconds:0}s while initializing " +
                $"'{componentType.Name}'. The gate holder's lifecycle is apparently awaiting work that itself " +
                "needs the gate — move that dependency out of the component lifecycle.");
    }

    public void Release() => _gate.Release();

    public void Dispose() => _gate.Dispose();
}