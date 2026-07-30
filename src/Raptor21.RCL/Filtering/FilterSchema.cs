using System.Linq.Expressions;

namespace Raptor21.RCL.Filtering;

/// <summary>What kind of control a field is filtered with — and therefore what shape its values take.</summary>
public enum FilterFieldKind
{
    /// <summary>Free text with an operator (contains / equals / starts with …).</summary>
    Text,

    /// <summary>Single number with an operator.</summary>
    Number,

    /// <summary>Numeric range (min–max), optionally with a unit/currency selector.</summary>
    NumberRange,

    /// <summary>Single date with an operator.</summary>
    Date,

    /// <summary>Date range (from–to).</summary>
    DateRange,

    /// <summary>Multi-select over a fixed option list.</summary>
    Set,

    /// <summary>Tri-state boolean (any / yes / no).</summary>
    Boolean,
}

/// <summary>The operators a condition can carry. Backend-neutral; each adapter maps them to its own dialect.</summary>
public enum FilterOperator
{
    Contains,
    Equals,
    NotEquals,
    StartsWith,
    EndsWith,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    Between,
    In,
    NotIn,
    IsNull,
    IsNotNull,
    IsTrue,
    IsFalse,
}

/// <summary>One selectable option for a <see cref="FilterFieldKind.Set"/> field.</summary>
public sealed record FilterOption(string Value, string Label, int? Count = null);

/// <summary>
/// One filterable field. As with grid columns, the <see cref="Key"/> is never hand-written for a bound
/// field: <see cref="For{T,TValue}"/> derives it from a member expression, so renaming the property is a
/// compile error rather than a silent mismatch.
/// </summary>
public sealed record FilterField
{
    private FilterField(string key, string label)
    {
        Key = key;
        Label = label;
    }

    /// <summary>Backend identifier — SQL column mapping key, Elastic field name, etc.</summary>
    public string Key { get; private init; }

    public string Label { get; init; }

    public FilterFieldKind Kind { get; init; } = FilterFieldKind.Text;

    /// <summary>Operators offered for Text/Number/Date kinds. Null = the kind's sensible default set.</summary>
    public IReadOnlyList<FilterOperator>? Operators { get; init; }

    /// <summary>Options for a <see cref="FilterFieldKind.Set"/> field.</summary>
    public IReadOnlyList<FilterOption>? Options { get; init; }

    /// <summary>Optional section heading, so the panel can group related fields.</summary>
    public string? Group { get; init; }

    public string? Placeholder { get; init; }

    /// <summary>Unit choices for a range (e.g. currencies: TL / USD / EUR). Rendered as tabs above the range.</summary>
    public IReadOnlyList<FilterOption>? Units { get; init; }

    /// <summary>
    /// Whether the user may stack more than one condition on this field (e.g. two contains clauses).
    /// The query model always supports it; this only controls whether the UI offers an "add" affordance.
    /// </summary>
    public bool AllowMultiple { get; init; }

    /// <summary>A field bound to a member — key derived from the expression, never written by hand.</summary>
    public static FilterField For<T, TValue>(Expression<Func<T, TValue>> selector, string label) =>
        new(MemberName(selector), label);

    /// <summary>A field with no CLR member behind it (e.g. a computed/Elastic-only field).</summary>
    public static FilterField Custom(string key, string label)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        return new FilterField(key, label);
    }

    private static string MemberName<T, TValue>(Expression<Func<T, TValue>> selector) => selector.Body switch
    {
        MemberExpression m => m.Member.Name,
        UnaryExpression { Operand: MemberExpression m } => m.Member.Name,
        _ => throw new ArgumentException(
            "Filter field selector must be a simple member access (e.g. o => o.OrderNumber). " +
            "For computed fields use FilterField.Custom(key, label).", nameof(selector))
    };

    /// <summary>The operators actually offered, falling back to a sensible set per kind.</summary>
    public IReadOnlyList<FilterOperator> EffectiveOperators => Operators ?? Kind switch
    {
        FilterFieldKind.Text =>
            [FilterOperator.Contains, FilterOperator.Equals, FilterOperator.StartsWith, FilterOperator.EndsWith, FilterOperator.NotEquals, FilterOperator.IsNull, FilterOperator.IsNotNull],
        FilterFieldKind.Number =>
            [FilterOperator.Equals, FilterOperator.GreaterThan, FilterOperator.GreaterThanOrEqual, FilterOperator.LessThan, FilterOperator.LessThanOrEqual, FilterOperator.NotEquals, FilterOperator.IsNull, FilterOperator.IsNotNull],
        FilterFieldKind.Date =>
            [FilterOperator.Equals, FilterOperator.GreaterThanOrEqual, FilterOperator.LessThanOrEqual, FilterOperator.IsNull, FilterOperator.IsNotNull],
        _ => [],
    };
}

/// <summary>
/// The set of fields a screen can be filtered by. This is the whole contract the filter UI needs — it
/// says nothing about SQL, Elastic or the grid, which is what lets the same panel drive any of them.
/// </summary>
public sealed record FilterSchema
{
    /// <summary>Stable id — used for the panel's DOM ids and its form field prefix.</summary>
    public required string Id { get; init; }

    public required IReadOnlyList<FilterField> Fields { get; init; }

    /// <summary>Where the panel posts to. Normally the owning page's own handler.</summary>
    public string Endpoint { get; init; } = string.Empty;

    public FilterField? Field(string key) =>
        Fields.FirstOrDefault(f => string.Equals(f.Key, key, StringComparison.OrdinalIgnoreCase));
}