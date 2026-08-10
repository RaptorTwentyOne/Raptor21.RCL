using Raptor21.RCL.Grid;

namespace Raptor21.RCL.Filtering.Adapters;

/// <summary>
/// Translates a <see cref="FilterQuery"/> into the grid's <see cref="GridFilter"/> list.
/// <para>
/// The core model (<see cref="FilterSchema"/>, <see cref="FilterQuery"/>) references nothing from
/// <c>Raptor21.RCL.Grid</c>; this adapter is the whole of what points the panel at a grid. A different
/// backend takes the analogous walk over <see cref="FilterQuery.Active"/> and emits its own dialect —
/// an Elastic query DSL, say — with no change to the panel, the schema or the binder.
/// </para>
/// </summary>
public static class GridFilterAdapter
{
    /// <summary>
    /// Maps every active condition; conditions whose operator the grid has no equivalent for are skipped.
    /// <para>
    /// <paramref name="searchColumn"/> opts the panel's free-text box in. It is a backend key with no
    /// schema field behind it — typically one the data provider expands into an OR across several real
    /// columns — so the consuming application names it, the same way a display-only grid column is
    /// named. Leave it null and <see cref="FilterQuery.Search"/> is ignored, since a search term has no
    /// generic translation.
    /// </para>
    /// <para>
    /// <paramref name="searchOperator"/> defaults to <see cref="FilterOperator.StartsWith"/> rather than
    /// Contains: a leading wildcard cannot use an index, so a Contains search fanned out over a wide
    /// table scans it. Opt into Contains only where the target columns are small or indexed for it.
    /// </para>
    /// </summary>
    public static List<GridFilter> ToGridFilters(
        this FilterQuery query,
        FilterSchema schema,
        string? searchColumn = null,
        FilterOperator searchOperator = FilterOperator.StartsWith)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(schema);

        List<GridFilter> filters = [];

        foreach (var condition in query.Active) // codeql[cs/linq/missed-where] the guard binds its subject (schema.Field pattern match)
        {
            if (schema.Field(condition.Field) is not { } field) continue;

            var dataType = DataType(field.Kind);

            if (condition.Operator is FilterOperator.Between)
            {
                var from = condition.Value;
                var to = condition.Value2;
                var hasFrom = !string.IsNullOrWhiteSpace(from);
                var hasTo = !string.IsNullOrWhiteSpace(to);

                if (hasFrom && hasTo)
                    filters.Add(new GridFilter
                    {
                        ColumnName = field.Key,
                        DataType = dataType,
                        Operation = GridFilterOperation.Between,
                        Value = from,
                        ValueTo = to
                    });
                else if (hasFrom)
                    filters.Add(new GridFilter
                    {
                        ColumnName = field.Key,
                        DataType = dataType,
                        Operation = GridFilterOperation.GreaterThanOrEqual,
                        Value = from
                    });
                else if (hasTo)
                    filters.Add(new GridFilter
                    {
                        ColumnName = field.Key,
                        DataType = dataType,
                        Operation = GridFilterOperation.LessThanOrEqual,
                        Value = to
                    });

                continue;
            }

            if (Operation(condition.Operator) is not { } operation) continue;

            filters.Add(new GridFilter
            {
                ColumnName = field.Key,
                DataType = dataType,
                Operation = operation,
                Value = condition.Value,
                Values = condition.Values.Count > 0 ? [.. condition.Values] : null
            });
        }

        if (!string.IsNullOrWhiteSpace(query.Search) && !string.IsNullOrWhiteSpace(searchColumn))
            filters.Add(new GridFilter
            {
                ColumnName = searchColumn,
                DataType = GridFilterDataType.Text,
                Operation = Operation(searchOperator) ?? GridFilterOperation.StartsWith,
                Value = query.Search.Trim()
            });

        return filters;
    }

    private static GridFilterDataType DataType(FilterFieldKind kind) => kind switch
    {
        FilterFieldKind.Number or FilterFieldKind.NumberRange => GridFilterDataType.Number,
        FilterFieldKind.Date or FilterFieldKind.DateRange => GridFilterDataType.Date,
        FilterFieldKind.Boolean => GridFilterDataType.Boolean,
        _ => GridFilterDataType.Text,
    };

    private static GridFilterOperation? Operation(FilterOperator op) => op switch
    {
        FilterOperator.Contains => GridFilterOperation.Contains,
        FilterOperator.Equals => GridFilterOperation.Equals,
        FilterOperator.NotEquals => GridFilterOperation.NotEquals,
        FilterOperator.StartsWith => GridFilterOperation.StartsWith,
        FilterOperator.EndsWith => GridFilterOperation.EndsWith,
        FilterOperator.GreaterThan => GridFilterOperation.GreaterThan,
        FilterOperator.GreaterThanOrEqual => GridFilterOperation.GreaterThanOrEqual,
        FilterOperator.LessThan => GridFilterOperation.LessThan,
        FilterOperator.LessThanOrEqual => GridFilterOperation.LessThanOrEqual,
        FilterOperator.In => GridFilterOperation.In,
        FilterOperator.NotIn => GridFilterOperation.NotIn,
        FilterOperator.IsNull => GridFilterOperation.IsNull,
        FilterOperator.IsNotNull => GridFilterOperation.IsNotNull,
        FilterOperator.IsTrue => GridFilterOperation.IsTrue,
        FilterOperator.IsFalse => GridFilterOperation.IsFalse,
        FilterOperator.Between => GridFilterOperation.Between,
        _ => null,
    };
}
