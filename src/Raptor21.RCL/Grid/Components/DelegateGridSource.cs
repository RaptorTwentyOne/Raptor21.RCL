namespace Raptor21.RCL.Grid.Components;

/// <summary>
/// Adapts a markup-declared grid (a <see cref="GridView{TRow}"/> assembled from <c>&lt;RaptorColumn&gt;</c>
/// children plus a data delegate) to <see cref="IGridSource{TRow}"/>, so the component render path can reuse
/// <see cref="RaptorGridBuilder.PrepareAsync{TRow}"/>. There is no <c>BuildView</c> to author by hand — the
/// view comes from the markup, and the rows from the page's items delegate.
/// </summary>
public sealed class DelegateGridSource<TRow>(
    GridView<TRow> view,
    Func<GridQueryState, string?, CancellationToken, Task<GridPage<TRow>>> itemsProvider,
    Func<TRow, string> rowKey) : IGridSource<TRow>
{
    public GridView<TRow> BuildView() => view;

    public Task<GridPage<TRow>> GetPageAsync(GridQueryState state, string? userId, CancellationToken ct) =>
        itemsProvider(state, userId, ct);

    public string RowKey(TRow row) => rowKey(row);
}
