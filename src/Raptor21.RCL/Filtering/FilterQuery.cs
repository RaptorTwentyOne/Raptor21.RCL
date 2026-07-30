using System.Globalization;

namespace Raptor21.RCL.Filtering;

/// <summary>
/// One condition the user has expressed: a field, an operator and its operands.
/// <para>
/// Operands are kept as strings. This record is what crosses the wire and what an adapter translates,
/// so it survives a round-trip through HTML form fields without a type registry;
/// <see cref="AsDecimal"/> / <see cref="AsDate"/> convert on demand, at the point where the target type
/// is known.
/// </para>
/// </summary>
public sealed record FilterCondition
{
    public required string Field { get; init; }
    public required FilterOperator Operator { get; init; }

    /// <summary>Primary operand — the text, the number, the lower bound of a range.</summary>
    public string? Value { get; init; }

    /// <summary>Upper bound, for <see cref="FilterOperator.Between"/>.</summary>
    public string? Value2 { get; init; }

    /// <summary>Selected values for <see cref="FilterOperator.In"/> / <see cref="FilterOperator.NotIn"/>.</summary>
    public IReadOnlyList<string> Values { get; init; } = [];

    /// <summary>Unit the operands are expressed in (e.g. currency code), when the field declares units.</summary>
    public string? Unit { get; init; }

    /// <summary>An operator that needs no operand is always meaningful; the rest need something to compare against.</summary>
    public bool HasValue => Operator switch
    {
        FilterOperator.IsNull or FilterOperator.IsNotNull or FilterOperator.IsTrue or FilterOperator.IsFalse => true,
        FilterOperator.In or FilterOperator.NotIn => Values.Count > 0,
        FilterOperator.Between => !string.IsNullOrWhiteSpace(Value) || !string.IsNullOrWhiteSpace(Value2),
        _ => !string.IsNullOrWhiteSpace(Value),
    };

    public decimal? AsDecimal(string? raw) =>
        decimal.TryParse(raw, NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : null;

    public DateTime? AsDate(string? raw) =>
        DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
}

/// <summary>
/// The complete filter state — an ordered list of conditions, nothing more.
/// <para>
/// This is the only thing the filter UI produces. It knows nothing about SQL, Elastic, or the grid,
/// which lets one panel drive any of them: a consumer writes a small adapter that walks
/// <see cref="Conditions"/> and emits its own dialect. Several conditions may share a
/// <see cref="FilterCondition.Field"/>; stacking two clauses on one field is a supported state.
/// </para>
/// </summary>
public sealed record FilterQuery
{
    public static readonly FilterQuery Empty = new();

    public IReadOnlyList<FilterCondition> Conditions { get; init; } = [];

    /// <summary>Free-text search box, when the panel shows one. Which fields it spans is the adapter's call.</summary>
    public string? Search { get; init; }

    public bool IsEmpty => Conditions.Count == 0 && string.IsNullOrWhiteSpace(Search);

    /// <summary>Conditions that actually carry an operand — what an adapter should translate.</summary>
    public IEnumerable<FilterCondition> Active => Conditions.Where(c => c.HasValue);

    public int ActiveCount => Active.Count();

    public IEnumerable<FilterCondition> For(string field) =>
        Active.Where(c => string.Equals(c.Field, field, StringComparison.OrdinalIgnoreCase));

    /// <summary>The first condition on a field — the common case for single-condition fields.</summary>
    public FilterCondition? First(string field) => For(field).FirstOrDefault();

    public bool Has(string field) => For(field).Any();

    public FilterQuery With(FilterCondition condition) =>
        this with { Conditions = [.. Conditions, condition] };

    /// <summary>Drops every condition on a field — what the panel's per-field clear does.</summary>
    public FilterQuery Without(string field) => this with
    {
        Conditions = [.. Conditions.Where(c => !string.Equals(c.Field, field, StringComparison.OrdinalIgnoreCase))]
    };
}
