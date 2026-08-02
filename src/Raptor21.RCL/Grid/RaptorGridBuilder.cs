using Microsoft.Extensions.Primitives;

namespace Raptor21.RCL.Grid;

/// <summary>
/// Builds a render-ready <see cref="GridViewModel"/> from a strongly-typed <see cref="IGridSource{TRow}"/>.
/// <para>
/// There is no grid registry, no lookup by id and no reflection: the caller already holds the source (its
/// own page), columns carry compiled accessors and typed cell renderers, and the row type never escapes
/// into the view — the partials only ever see finished HTML plus the non-generic
/// <see cref="GridColumnView"/> projection.
/// </para>
/// </summary>
public sealed class RaptorGridBuilder(
    IGridAuthorization authorization,
    IGridUserContext userContext,
    GridRequestBinder binder,
    IEnumerable<IGridSetOptionsProvider> setOptionsProviders)
{
    private readonly IReadOnlyDictionary<string, IGridSetOptionsProvider> _setOptionsProviders =
        setOptionsProviders
            .GroupBy(p => p.Key, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Last(), StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Parses the request (htmx form on POST, query string on first load), fetches one page and renders it
    /// to a <see cref="GridViewModel"/> — the <c>.cshtml</c> render path, where every cell is finished HTML.
    /// The Blazor <c>&lt;RaptorGrid&gt;</c> path calls <see cref="PrepareAsync{TRow}"/> instead and renders
    /// cells from markup templates; both share the same permission-filter / set-option / bind / fetch prep.
    /// </summary>
    public async Task<GridViewModel> BuildAsync<TRow>(
        IGridSource<TRow> source,
        IEnumerable<KeyValuePair<string, StringValues>> request,
        GridEndpoints endpoints,
        CancellationToken ct = default,
        bool deferred = false)
    {
        ArgumentNullException.ThrowIfNull(source);

        var view = source.BuildView();
        var userId = userContext.UserId;
        var prepared = await PrepareAsync(source, view, request, ct, deferred);

        var rows = new List<GridRow>(prepared.Rows.Count);
        foreach (var row in prepared.Rows)
        {
            var cells = new List<GridCell>(prepared.Columns.Count);
            foreach (var column in prepared.Columns)
                cells.Add(RenderCell(column, row));

            rows.Add(new GridRow(source.RowKey(row), cells, view.Card?.Invoke(row).Html));
        }

        var state = prepared.State;
        var pageSize = state.PageSize <= 0 ? view.PageSize : state.PageSize;
        var totalPages = pageSize == 0 ? 0 : (int)Math.Ceiling(prepared.TotalCount / (decimal)pageSize);
        var sort = state.Sorts.FirstOrDefault();
        var (filterValues, filterOps, setSelections) = BuildFilterState(state);

        return new GridViewModel
        {
            GridId = view.Id,
            Endpoint = endpoints.Region,
            BlockEndpoint = endpoints.Block,
            CellEndpoint = endpoints.Cell,
            Columns = [.. prepared.Columns.Select(GridColumnView.From)],
            Rows = rows,
            State = state,
            TotalCount = prepared.TotalCount,
            TotalPages = totalPages,
            PageSizeOptions = view.PageSizeOptions,
            Deferred = deferred,
            MasterDetail = view.MasterDetail,
            DetailUrl = view.DetailUrl,
            HasCards = view.Card is not null,
            VirtualScroll = view.VirtualScroll,
            Include = view.Include,
            Compact = view.Compact,
            Selectable = view.Selectable,
            FilterEntry = view.FilterEntry,
            CanEdit = view.EditPermission is not null
                      && await authorization.HasPermissionAsync(userId, view.EditPermission, ct),
            SortField = sort?.ColumnName,
            SortDir = sort?.Direction == GridSortDirection.Descending ? "desc" : "asc",
            FilterValues = filterValues,
            FilterOps = filterOps,
            SetSelections = setSelections
        };
    }

    /// <summary>
    /// The render-independent half of a grid build: permission-filter the columns, resolve any dynamic Set
    /// options, bind the request into a <see cref="GridQueryState"/>, apply the user's column order, and
    /// fetch one page. Returns the typed columns and <b>raw</b> rows — no cells are rendered — so a caller
    /// can render each cell however it likes (finished-HTML <see cref="GridCell"/> for the partial path, or a
    /// Blazor <c>RenderFragment</c> template for the <c>&lt;RaptorGrid&gt;</c> component path).
    /// </summary>
    public Task<PreparedGrid<TRow>> PrepareAsync<TRow>(
        IGridSource<TRow> source,
        IEnumerable<KeyValuePair<string, StringValues>> request,
        CancellationToken ct = default,
        bool deferred = false)
    {
        ArgumentNullException.ThrowIfNull(source);
        return PrepareAsync(source, source.BuildView(), request, ct, deferred);
    }

    private async Task<PreparedGrid<TRow>> PrepareAsync<TRow>(
        IGridSource<TRow> source,
        GridView<TRow> view,
        IEnumerable<KeyValuePair<string, StringValues>> request,
        CancellationToken ct,
        bool deferred)
    {
        var userId = userContext.UserId;

        var visible = await VisibleColumnsAsync(view.Columns, userId, ct);
        visible = await ResolveDynamicSetOptionsAsync(visible, userId, ct);

        var state = binder.Bind(request, [.. visible.Select(GridColumnView.From)], view.PageSize, view.ContextParams);
        visible = ApplyColumnOrder(visible, state.ColumnOrder);

        GridPage<TRow> page = deferred
            ? new GridPage<TRow> { Rows = [], TotalCount = 0, CurrentPage = state.Page }
            : await source.GetPageAsync(state, userId, ct);

        var canEdit = view.EditPermission is not null
                      && await authorization.HasPermissionAsync(userId, view.EditPermission, ct);

        return new PreparedGrid<TRow>(visible, page.Rows, state, page.TotalCount, canEdit);
    }

    /// <summary>
    /// Renders a single row for an inline-edit swap, using the exact same permission-filtered, user-ordered
    /// columns as the full grid so the replaced &lt;tr&gt; stays column-aligned with the live header.
    /// </summary>
    public async Task<GridRowViewModel> BuildRowAsync<TRow>(
        IGridSource<TRow> source,
        TRow row,
        IEnumerable<KeyValuePair<string, StringValues>> request,
        CancellationToken ct = default)
    {
        var view = source.BuildView();
        var userId = userContext.UserId;

        var visible = await VisibleColumnsAsync(view.Columns, userId, ct);
        var state = binder.Bind(request, [.. visible.Select(GridColumnView.From)], view.PageSize, view.ContextParams);
        visible = ApplyColumnOrder(visible, state.ColumnOrder);

        var cells = new List<GridCell>(visible.Count);
        foreach (var column in visible)
            cells.Add(RenderCell(column, row));

        return new GridRowViewModel
        {
            GridId = view.Id,
            Columns = [.. visible.Select(GridColumnView.From)],
            Row = new GridRow(source.RowKey(row), cells, view.Card?.Invoke(row).Html),
            Selectable = view.Selectable,
            CanEdit = view.EditPermission is not null
                      && await authorization.HasPermissionAsync(userId, view.EditPermission, ct),
            HasDetail = view.MasterDetail && !string.IsNullOrEmpty(view.DetailUrl),
            DetailUrl = view.DetailUrl
        };
    }

    /// <summary>Typed cell render — the column's renderer, else the compiled accessor's value as text.</summary>
    private static GridCell RenderCell<TRow>(GridColumn<TRow> column, TRow row) =>
        column.Cell is { } cell
            ? cell(row)
            : GridCell.Text(column.Value?.Invoke(row)?.ToString());

    /// <summary>
    /// Fills the <see cref="GridColumn{TRow}.SetOptions"/> of any column that declared a
    /// <see cref="GridColumn{TRow}.SetOptionsKey"/> from the matching registered
    /// <see cref="IGridSetOptionsProvider"/>. Each distinct key is resolved once (so two columns sharing a key share a
    /// single load); an unknown key or an absent provider leaves the column with no options — the popup then
    /// simply renders empty rather than throwing. Columns with no key are returned untouched.
    /// </summary>
    private async Task<List<GridColumn<TRow>>> ResolveDynamicSetOptionsAsync<TRow>(
        List<GridColumn<TRow>> columns, string? userId, CancellationToken ct)
    {
        if (columns.All(c => c.SetOptionsKey is null))
            return columns;

        var resolved = new Dictionary<string, IReadOnlyList<GridSetOption>>(StringComparer.OrdinalIgnoreCase);
        var result = new List<GridColumn<TRow>>(columns.Count);
        foreach (var column in columns)
        {
            if (column.SetOptionsKey is not { } key)
            {
                result.Add(column);
                continue;
            }

            if (!resolved.TryGetValue(key, out var options))
            {
                options = _setOptionsProviders.TryGetValue(key, out var provider)
                    ? await provider.GetOptionsAsync(userId, ct)
                    : [];
                resolved[key] = options;
            }

            result.Add(column with { SetOptions = options });
        }

        return result;
    }

    private async Task<List<GridColumn<TRow>>> VisibleColumnsAsync<TRow>(
        IReadOnlyList<GridColumn<TRow>> columns, string? userId, CancellationToken ct)
    {
        var result = new List<GridColumn<TRow>>(columns.Count);
        foreach (var column in columns)
        {
            if (column.Permission is null || await authorization.HasPermissionAsync(userId, column.Permission, ct))
                result.Add(column);
        }

        return result;
    }

    /// <summary>
    /// Reorders the non-pinned ("middle") columns by the user's saved order; pinned sides stay put and
    /// columns missing from the saved order are appended in definition order so they never vanish.
    /// </summary>
    private static List<GridColumn<TRow>> ApplyColumnOrder<TRow>(List<GridColumn<TRow>> visible, IReadOnlyList<string> order)
    {
        if (order.Count == 0) return visible;

        var middle = visible.Where(c => c.Pinned is null).ToList();
        var byKey = middle.ToDictionary(c => c.Key, StringComparer.OrdinalIgnoreCase);

        var reordered = new List<GridColumn<TRow>>(middle.Count);
        foreach (var key in order)
            if (byKey.Remove(key, out var col))
                reordered.Add(col);
        foreach (var col in middle)
            if (byKey.ContainsKey(col.Key))
                reordered.Add(col);

        return
        [
            .. visible.Where(c => c.Pinned == "left"),
            .. reordered,
            .. visible.Where(c => c.Pinned == "right"),
        ];
    }

    internal static (
        IReadOnlyDictionary<string, string> Values,
        IReadOnlyDictionary<string, string> Ops,
        IReadOnlyDictionary<string, IReadOnlyCollection<string>> SetSelections) BuildFilterState(GridQueryState state)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var ops = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var sets = new Dictionary<string, IReadOnlyCollection<string>>(StringComparer.OrdinalIgnoreCase);

        foreach (var filter in state.Filters)
        {
            if (filter.Operation == GridFilterOperation.In)
            {
                if (filter.Values is { Count: > 0 })
                    sets[filter.ColumnName] = new HashSet<string>(filter.Values, StringComparer.OrdinalIgnoreCase);
                continue;
            }

            if (!string.IsNullOrEmpty(filter.Value))
                values[filter.ColumnName] = filter.Value;
            ops[filter.ColumnName] = GridFilterOps.Key(filter.Operation);
        }

        return (values, ops, sets);
    }
}

/// <summary>
/// The render-independent result of <see cref="RaptorGridBuilder.PrepareAsync{TRow}(IGridSource{TRow}, System.Collections.Generic.IEnumerable{System.Collections.Generic.KeyValuePair{string, StringValues}}, System.Threading.CancellationToken, bool)"/>:
/// the permission-filtered, user-ordered columns (with dynamic Set options resolved), the raw fetched
/// rows, the bound query state, the total row count and whether the current user may inline-edit. Cells are
/// not rendered here — the caller renders them (finished-HTML <see cref="GridCell"/> for the partial path,
/// or a Blazor <c>RenderFragment</c> template for the <c>&lt;RaptorGrid&gt;</c> path).
/// </summary>
public sealed record PreparedGrid<TRow>(
    IReadOnlyList<GridColumn<TRow>> Columns,
    IReadOnlyList<TRow> Rows,
    GridQueryState State,
    int TotalCount,
    bool CanEdit);