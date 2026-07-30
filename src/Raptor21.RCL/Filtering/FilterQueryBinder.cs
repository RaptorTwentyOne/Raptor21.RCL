using System.Text.RegularExpressions;
using Microsoft.Extensions.Primitives;

namespace Raptor21.RCL.Filtering;

/// <summary>
/// Turns a posted form (or a query string) into a <see cref="FilterQuery"/>.
/// <para>
/// Conditions are indexed rather than keyed by field name, because a field may carry several of them:
/// <c>c[0].field</c>, <c>c[0].op</c>, <c>c[0].v</c>, <c>c[0].v2</c>, <c>c[0].unit</c>, and repeated
/// <c>c[0].vs</c> for multi-select. Indexes need not be contiguous — the panel may delete a condition
/// without renumbering the rest.
/// </para>
/// <para>
/// Only fields declared in the <see cref="FilterSchema"/> are honored and only operators the field
/// actually offers are accepted; anything else is dropped. The schema is the whitelist, which is what
/// makes it safe to hand the result to a SQL adapter.
/// </para>
/// </summary>
public sealed partial class FilterQueryBinder
{
    [GeneratedRegex(@"^c\[(\d+)\]\.(field|op|v|v2|unit|vs)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ConditionKey { get; }

    public FilterQuery Bind(IEnumerable<KeyValuePair<string, StringValues>> source, FilterSchema schema)
    {
        ArgumentNullException.ThrowIfNull(schema);

        var slots = new SortedDictionary<int, Dictionary<string, StringValues>>();
        string? search = null;

        foreach (var (key, value) in source)
        {
            if (string.Equals(key, "search", StringComparison.OrdinalIgnoreCase))
            {
                search = value.ToString();
                continue;
            }

            if (ConditionKey.Match(key) is not { Success: true } m) continue;
            if (!int.TryParse(m.Groups[1].ValueSpan, out var index)) continue;

            var slot = slots.TryGetValue(index, out var existing)
                ? existing
                : slots[index] = new Dictionary<string, StringValues>(StringComparer.OrdinalIgnoreCase);
            slot[m.Groups[2].Value] = value;
        }

        List<FilterCondition> conditions = [];
        foreach (var slot in slots.Values)
        {
            if (Build(slot, schema) is { } condition)
                conditions.Add(condition);
        }

        return new FilterQuery
        {
            Conditions = conditions,
            Search = string.IsNullOrWhiteSpace(search) ? null : search.Trim()
        };
    }

    private static FilterCondition? Build(IReadOnlyDictionary<string, StringValues> slot, FilterSchema schema)
    {
        if (Text(slot, "field") is not { Length: > 0 } fieldKey) return null;

        if (schema.Field(fieldKey) is not { } field) return null;

        var op = ResolveOperator(Text(slot, "op"), field);
        if (op is null) return null;

        var values = slot.TryGetValue("vs", out var vs)
            ? vs.Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => v!).Distinct(StringComparer.Ordinal).ToList()
            : [];

        var unit = Text(slot, "unit");
        if (unit is not null && field.Units?.Any(u => string.Equals(u.Value, unit, StringComparison.OrdinalIgnoreCase)) != true)
            unit = null;

        var condition = new FilterCondition
        {
            Field = field.Key,
            Operator = op.Value,
            Value = Text(slot, "v"),
            Value2 = Text(slot, "v2"),
            Values = values,
            Unit = unit,
        };

        return condition.HasValue ? condition : null;
    }

    /// <summary>
    /// Maps the posted operator onto one the field actually offers. Kinds whose operator is implied by
    /// the control (ranges, sets, booleans) don't post one at all, so they resolve structurally.
    /// </summary>
    private static FilterOperator? ResolveOperator(string? raw, FilterField field)
    {
        var parsed = Enum.TryParse<FilterOperator>(raw, ignoreCase: true, out var value) ? value : (FilterOperator?)null;

        switch (field.Kind)
        {
            case FilterFieldKind.NumberRange or FilterFieldKind.DateRange:
                return FilterOperator.Between;

            case FilterFieldKind.Set:
                return parsed is FilterOperator.NotIn ? FilterOperator.NotIn : FilterOperator.In;

            case FilterFieldKind.Boolean:
                return parsed is FilterOperator.IsTrue or FilterOperator.IsFalse ? parsed : null;

            default:
                var allowed = field.EffectiveOperators;
                if (parsed is { } p && allowed.Contains(p)) return p;
                return allowed.Count > 0 ? allowed[0] : null;
        }
    }

    private static string? Text(IReadOnlyDictionary<string, StringValues> slot, string key) =>
        slot.TryGetValue(key, out var v) && v.ToString() is { Length: > 0 } s && !string.IsNullOrWhiteSpace(s)
            ? s.Trim()
            : null;
}
