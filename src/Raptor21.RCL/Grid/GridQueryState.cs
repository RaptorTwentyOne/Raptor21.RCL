namespace Raptor21.RCL.Grid;

/// <summary>
/// The parsed grid request: page/size plus the library-owned <see cref="GridFilter"/>/<see cref="GridSort"/>
/// the data provider maps to its own query model. Produced by <see cref="GridRequestBinder"/> from the
/// htmx form (or query string on first load), honoring only columns declared in the definition.
/// </summary>
public sealed class GridQueryState
{
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 25;
    public List<GridFilter> Filters { get; init; } = [];
    public List<GridSort> Sorts { get; init; } = [];

    /// <summary>User's data-column order (non-pinned field names), from the client's persisted
    /// preference echoed as the <c>colOrder</c> param. Empty = definition order.</summary>
    public List<string> ColumnOrder { get; init; } = [];

    /// <summary>Row keys selected client-side (checkbox selection).</summary>
    public HashSet<string> Selected { get; init; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Pass-through context values (see <see cref="GridView{TRow}.ContextParams"/>), captured
    /// from the definition and the request's <c>ctx_*</c> fields. Data providers read these to
    /// parameterize their query (e.g. a parent record id for a nested child grid).</summary>
    public Dictionary<string, string> Params { get; init; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Convenience accessor for a context param (null when absent).</summary>
    public string? Param(string key) => Params.TryGetValue(key, out var v) ? v : null;
}
