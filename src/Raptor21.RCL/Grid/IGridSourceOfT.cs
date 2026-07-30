namespace Raptor21.RCL.Grid;

/// <summary>
/// One grid, strongly typed over its row. Implemented by the Razor Page (or any class) that owns the
/// grid: it declares the columns, fetches a page, and identifies a row — all without reflection and
/// without the library resolving anything by a magic string.
/// <para>
/// Because the hosting page implements this itself, the grid's POST handler lives on that page
/// (<c>OnPostGridAsync</c>) and calls the library's render helper directly — the library registers no
/// routes and needs no string-keyed DI lookup.
/// </para>
/// </summary>
public interface IGridSource<TRow>
{
    /// <summary>The typed column definition + options for this grid.</summary>
    GridView<TRow> BuildView();

    /// <summary>Fetch one page for the current filter / sort / paging state.</summary>
    Task<GridPage<TRow>> GetPageAsync(GridQueryState state, string? userId, CancellationToken ct);

    /// <summary>Stable identity for a row (used for selection, master-detail and row swaps).</summary>
    string RowKey(TRow row);
}

/// <summary>One page of typed rows plus the totals the pager needs.</summary>
public sealed record GridPage<TRow>
{
    public required IReadOnlyList<TRow> Rows { get; init; }
    public required int TotalCount { get; init; }
    public int CurrentPage { get; init; } = 1;
}

/// <summary>
/// A grid that also supports inline cell editing. Kept separate from <see cref="IGridSource{TRow}"/> so
/// the edit endpoint is structurally unavailable to read-only grids: a page that does not implement this
/// cannot compile a cell handler.
/// </summary>
public interface IGridEditableSource<TRow> : IGridSource<TRow>
{
    /// <summary>Patch one field of one row, returning the refreshed row so the swapped &lt;tr&gt; reflects
    /// the stored value.</summary>
    Task<GridCellUpdateResult<TRow>> UpdateCellAsync(
        string rowKey, string columnKey, string? value, string? userId, CancellationToken ct);
}

/// <summary>Outcome of an inline cell edit.</summary>
public sealed record GridCellUpdateResult<TRow>(bool Success, string? Error = null, TRow? Row = default)
{
    public static GridCellUpdateResult<TRow> Ok(TRow row) => new(true, null, row);
    public static GridCellUpdateResult<TRow> Invalid(string error) => new(false, error);
}
