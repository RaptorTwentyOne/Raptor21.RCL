namespace Raptor21.RCL.Grid;

/// <summary>
/// Maps the filter operation keys used in the header popups (e.g. "contains", "greaterThan") to the
/// library-owned <see cref="GridFilterOperation"/>, and lists the operation options each grid filter
/// type offers.
/// </summary>
public static class GridFilterOps
{
    private static readonly Dictionary<string, GridFilterOperation> ToOperation = new(StringComparer.OrdinalIgnoreCase)
    {
        ["contains"] = GridFilterOperation.Contains,
        ["equals"] = GridFilterOperation.Equals,
        ["notEquals"] = GridFilterOperation.NotEquals,
        ["startsWith"] = GridFilterOperation.StartsWith,
        ["endsWith"] = GridFilterOperation.EndsWith,
        ["greaterThan"] = GridFilterOperation.GreaterThan,
        ["lessThan"] = GridFilterOperation.LessThan,
        ["greaterThanOrEqual"] = GridFilterOperation.GreaterThanOrEqual,
        ["lessThanOrEqual"] = GridFilterOperation.LessThanOrEqual
    };

    private static readonly Dictionary<GridFilterOperation, string> ToKey =
        ToOperation.GroupBy(kv => kv.Value).ToDictionary(g => g.Key, g => g.First().Key);

    public static bool TryParse(string? key, out GridFilterOperation operation) =>
        ToOperation.TryGetValue(key ?? string.Empty, out operation);

    public static string Key(GridFilterOperation operation) =>
        ToKey.TryGetValue(operation, out var key) ? key : "contains";

    public static string DefaultKey(GridFilterType filter) =>
        filter == GridFilterType.Text ? "contains" : "equals";

    /// <summary>Operation options (key + label) offered by a column's filter popup, in display order.</summary>
    public static IReadOnlyList<(string Key, string Label)> Options(GridFilterType filter) => filter switch
    {
        GridFilterType.Number =>
        [
            ("equals", "Equals"), ("notEquals", "Not equals"),
            ("greaterThan", "Greater than"), ("lessThan", "Less than"),
            ("greaterThanOrEqual", "Greater than or equal"), ("lessThanOrEqual", "Less than or equal")
        ],
        GridFilterType.Date =>
        [
            ("equals", "Equals"), ("greaterThan", "After"), ("lessThan", "Before")
        ],
        _ =>
        [
            ("contains", "Contains"), ("equals", "Equals"), ("notEquals", "Not equals"),
            ("startsWith", "Starts with"), ("endsWith", "Ends with")
        ]
    };
}
