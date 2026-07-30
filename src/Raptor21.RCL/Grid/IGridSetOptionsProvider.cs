namespace Raptor21.RCL.Grid;

/// <summary>
/// Supplies the options for a <b>dynamic</b> <see cref="GridFilterType.Set"/> filter — one whose choices are
/// not known when the (synchronous) <see cref="IGridSource{TRow}.BuildView"/> runs because they depend on the
/// current user or on data (the canonical case being the set of values the current user is permitted to see).
/// <para>
/// A column opts in by setting <see cref="GridColumn{TRow}.SetOptionsKey"/> to a provider's <see cref="Key"/>.
/// <see cref="RaptorGridBuilder"/> then resolves the matching provider asynchronously and injects the returned
/// options into the column's <see cref="GridColumn{TRow}.SetOptions"/> before the filter popup is rendered, so
/// the popup shows real checkboxes exactly as a statically-populated Set filter would.
/// </para>
/// <para>
/// Providers are registered in DI (typically <c>Scoped</c>, since they usually load per-user data) and matched
/// by <see cref="Key"/> (case-insensitive). Each distinct key is resolved at most once per grid render, so
/// several columns can share one key (e.g. two columns filtering the same lookup) without loading it twice.
/// </para>
/// </summary>
public interface IGridSetOptionsProvider
{
    /// <summary>Stable key a column references via <see cref="GridColumn{TRow}.SetOptionsKey"/> (e.g. "region").</summary>
    string Key { get; }

    /// <summary>Resolves the option list for the given user. Return an empty list when there is nothing to offer.</summary>
    Task<IReadOnlyList<GridSetOption>> GetOptionsAsync(string? userId, CancellationToken ct);
}
