using Microsoft.Extensions.Primitives;

namespace Raptor21.RCL.Grid;

/// <summary>
/// Turns the htmx form (or the query string on first load) into a <see cref="GridQueryState"/>.
/// Only columns declared in the definition are honored — unknown field names are ignored, which is
/// the injection guard (data providers further whitelist via their own column mappings).
///
/// Field conventions:
///   page, pageSize, sort, dir            — paging + single-column sort
///   f_{field}                            — text/number/date value (op derived from the column filter)
///   f_{field}_to                         — upper bound for a range (reserved; not emitted yet)
///   fs_{field}                           — repeated set-filter values (In)
/// </summary>
public sealed class GridRequestBinder
{
    /// <summary>
    /// Binds against the column projection. Only declared columns are honored — unknown field names are
    /// ignored (the injection guard).
    /// </summary>
    public GridQueryState Bind(
        IEnumerable<KeyValuePair<string, StringValues>> source,
        IReadOnlyList<GridColumnView> columns,
        int defaultPageSize,
        IReadOnlyDictionary<string, string> contextParams)
    {
        var form = new Dictionary<string, StringValues>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in source)
            form[kv.Key] = kv.Value;

        var pageSize = GetInt(form, "pageSize", defaultPageSize);
        if (pageSize <= 0) pageSize = defaultPageSize;

        var state = new GridQueryState
        {
            Page = Math.Max(1, GetInt(form, "page", 1)),
            PageSize = pageSize
        };

        BindSort(form, columns, state);
        BindFilters(form, columns, state);
        BindColumnOrder(form, columns, state);
        BindContext(form, contextParams, state);

        return state;
    }

    /// <summary>
    /// Seeds the context params from the definition and then overlays any <c>ctx_*</c> request fields,
    /// so a value present on the request wins over the definition's.
    /// </summary>
    private static void BindContext(IReadOnlyDictionary<string, StringValues> form, IReadOnlyDictionary<string, string> contextParams, GridQueryState state)
    {
        foreach (var kv in contextParams)
            state.Params[kv.Key] = kv.Value;

        foreach (var kv in form)
        {
            if (kv.Key.Length > 4 && kv.Key.StartsWith("ctx_", StringComparison.OrdinalIgnoreCase))
                state.Params[kv.Key[4..]] = kv.Value.ToString();
        }
    }

    private static void BindColumnOrder(IReadOnlyDictionary<string, StringValues> form, IReadOnlyList<GridColumnView> columns, GridQueryState state)
    {
        var raw = GetString(form, "colOrder");
        if (string.IsNullOrWhiteSpace(raw)) return;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var token in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var column = columns.FirstOrDefault(c =>
                c.Pinned is null && string.Equals(c.Key, token, StringComparison.OrdinalIgnoreCase));
            if (column is not null && seen.Add(column.Key))
                state.ColumnOrder.Add(column.Key);
        }
    }

    private static void BindSort(IReadOnlyDictionary<string, StringValues> form, IReadOnlyList<GridColumnView> columns, GridQueryState state)
    {
        var sort = GetString(form, "sort");
        if (string.IsNullOrWhiteSpace(sort)) return;

        var column = columns.FirstOrDefault(c =>
            c.Sortable && string.Equals(c.Key, sort, StringComparison.OrdinalIgnoreCase));
        if (column is null) return;

        var desc = string.Equals(GetString(form, "dir"), "desc", StringComparison.OrdinalIgnoreCase);
        state.Sorts.Add(new GridSort
        {
            ColumnName = column.Key,
            Direction = desc ? GridSortDirection.Descending : GridSortDirection.Ascending,
            SortIndex = 0
        });
    }

    private static void BindFilters(IReadOnlyDictionary<string, StringValues> form, IReadOnlyList<GridColumnView> columns, GridQueryState state)
    {
        foreach (var column in columns)
        {
            switch (column.Filter)
            {
                case GridFilterType.None:
                    continue;

                case GridFilterType.Set:
                {
                    var values = form.TryGetValue($"fs_{column.Key}", out var sv)
                        ? sv.Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => v!).ToList()
                        : [];
                    if (values.Count > 0)
                        state.Filters.Add(new GridFilter
                        {
                            ColumnName = column.Key,
                            DataType = column.SetDataType,
                            Operation = GridFilterOperation.In,
                            Values = values,
                            LogicalOperator = GridLogicalOperator.And
                        });
                    continue;
                }

                default:
                {
                    var value = GetString(form, $"f_{column.Key}");
                    if (string.IsNullOrWhiteSpace(value)) continue;

                    var dataType = column.Filter switch
                    {
                        GridFilterType.Number => GridFilterDataType.Number,
                        GridFilterType.Date => GridFilterDataType.Date,
                        _ => GridFilterDataType.Text
                    };

                    var operation = GridFilterOps.TryParse(GetString(form, $"fop_{column.Key}"), out var parsed)
                        ? parsed
                        : column.Filter switch
                        {
                            GridFilterType.Number or GridFilterType.Date => GridFilterOperation.Equals,
                            _ => GridFilterOperation.Contains
                        };

                    state.Filters.Add(new GridFilter
                    {
                        ColumnName = column.Key,
                        DataType = dataType,
                        Operation = operation,
                        Value = value,
                        LogicalOperator = GridLogicalOperator.And
                    });
                    continue;
                }
            }
        }
    }

    private static int GetInt(IReadOnlyDictionary<string, StringValues> form, string key, int fallback) =>
        form.TryGetValue(key, out var v) && int.TryParse(v.ToString(), out var i) ? i : fallback;

    private static string? GetString(IReadOnlyDictionary<string, StringValues> form, string key) =>
        form.TryGetValue(key, out var v) ? v.ToString() : null;
}
