using Microsoft.Extensions.Primitives;
using Raptor21.RCL.Rendering;

namespace Raptor21.RCL.Grid;

/// <summary>
/// Prepares a grid render from a strongly-typed <see cref="IGridSource{TRow}"/>: permission-filters the
/// columns, resolves dynamic Set options, binds the request into a <see cref="GridQueryState"/> and fetches
/// one page.
/// <para>
/// There is no grid registry, no lookup by id and no reflection: the caller already holds the source (its
/// own page) and columns carry compiled accessors and typed cell renderers.
/// </para>
/// </summary>
public sealed class RaptorGridBuilder(
    IGridAuthorization authorization,
    IGridUserContext userContext,
    GridRequestBinder binder,
    IEnumerable<IGridSetOptionsProvider> setOptionsProviders,
    RaptorRenderGate gate)
{
    private readonly IReadOnlyDictionary<string, IGridSetOptionsProvider> _setOptionsProviders =
        setOptionsProviders
            .GroupBy(p => p.Key, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Last(), StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// The render-independent half of a grid build: permission-filter the columns, resolve any dynamic Set
    /// options, bind the request into a <see cref="GridQueryState"/>, apply the user's column order, and
    /// fetch one page. Returns the typed columns and <b>raw</b> rows — no cells are rendered — so a caller
    /// can render each cell however it likes (the <c>&lt;RaptorGrid&gt;</c> component renders them from its
    /// markup templates).
    /// <para>
    /// The whole data phase — the host's <see cref="IGridAuthorization"/>,
    /// <see cref="IGridSetOptionsProvider"/> and <see cref="IGridSource{TRow}.GetPageAsync"/> callbacks —
    /// runs as ONE exclusive section under the request's <see cref="RaptorRenderGate"/>, so the package
    /// never invokes two host data callbacks in parallel within one scope. This entry ACQUIRES the gate,
    /// so it is for callers outside the component seam (a handler composing a grid by hand, a plain
    /// component's data phase); the <c>&lt;RaptorGrid&gt;</c> region enters through
    /// <see cref="PrepareUnderCallerGateAsync{TRow}"/> instead, because its
    /// <see cref="RaptorSequentialComponent"/> lifecycle already holds the gate — calling this overload
    /// from such a lifecycle would nest acquisitions and time out.
    /// </para>
    /// </summary>
    public Task<PreparedGrid<TRow>> PrepareAsync<TRow>(
        IGridSource<TRow> source,
        IEnumerable<KeyValuePair<string, StringValues>> request,
        CancellationToken ct = default,
        bool deferred = false)
    {
        ArgumentNullException.ThrowIfNull(source);
        return gate.RunExclusiveAsync(typeof(RaptorGridBuilder),
            () => PrepareAsync(source, source.BuildView(), request, ct, deferred));
    }

    /// <summary>
    /// The non-acquiring twin of <see cref="PrepareAsync{TRow}(IGridSource{TRow}, IEnumerable{KeyValuePair{string, StringValues}}, CancellationToken, bool)"/>
    /// for a caller that ALREADY holds the request's <see cref="RaptorRenderGate"/> — the grid region's
    /// <see cref="RaptorSequentialComponent"/> lifecycle. Explicit declaration rather than ambient
    /// detection: an <c>AsyncLocal</c> marker cannot tell a directly-awaited nested call apart from a
    /// flow the renderer forked under the holder's context, so reentrancy is granted only here, where the
    /// caller's type proves the claim.
    /// </summary>
    internal Task<PreparedGrid<TRow>> PrepareUnderCallerGateAsync<TRow>(
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
/// not rendered here — the <c>&lt;RaptorGrid&gt;</c> component renders them from its markup templates.
/// </summary>
public sealed record PreparedGrid<TRow>(
    IReadOnlyList<GridColumn<TRow>> Columns,
    IReadOnlyList<TRow> Rows,
    GridQueryState State,
    int TotalCount,
    bool CanEdit);