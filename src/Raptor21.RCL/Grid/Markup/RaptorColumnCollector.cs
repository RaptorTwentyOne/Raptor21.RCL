namespace Raptor21.RCL.Grid.Markup;

/// <summary>
/// The cascaded bucket a <see cref="RaptorGridColumns{TRow}"/> hands down to its
/// <see cref="RaptorColumn{TRow}"/> children: each column registers the <see cref="GridColumn{TRow}"/>
/// it built from its markup here, in document order. One instance per grid render.
/// </summary>
public sealed class RaptorColumnCollector<TRow>
{
    private readonly List<GridColumn<TRow>> _columns = [];

    public IReadOnlyList<GridColumn<TRow>> Columns => _columns;

    public void Add(GridColumn<TRow> column) => _columns.Add(column);
}
