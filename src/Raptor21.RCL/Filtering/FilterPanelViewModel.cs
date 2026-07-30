namespace Raptor21.RCL.Filtering;

/// <summary>One rendered condition row: a field, the state it currently holds, and its wire index.</summary>
public sealed record FilterConditionView
{
    /// <summary>Index used in the form field names (<c>c[{Index}].v</c>). Unique across the whole panel.</summary>
    public required int Index { get; init; }

    public required FilterField Field { get; init; }

    /// <summary>Current state, or null for the empty slot a field always offers.</summary>
    public FilterCondition? Condition { get; init; }

    public FilterOperator? Operator => Condition?.Operator;
    public string? Value => Condition?.Value;
    public string? Value2 => Condition?.Value2;
    public string? Unit => Condition?.Unit;
    public IReadOnlyList<string> Values => Condition?.Values ?? [];

    public bool IsSelected(string optionValue) =>
        Values.Contains(optionValue, StringComparer.OrdinalIgnoreCase);

    public string Name(string part) => $"c[{Index}].{part}";
}

/// <summary>A field as the panel shows it: its label, its conditions, and whether any of them are live.</summary>
public sealed record FilterFieldView
{
    public required FilterField Field { get; init; }
    public required IReadOnlyList<FilterConditionView> Conditions { get; init; }

    /// <summary>How many of this field's conditions currently carry a value — drives the section's badge.</summary>
    public int ActiveCount => Conditions.Count(c => c.Condition is not null);
    public bool IsActive => ActiveCount > 0;
}

/// <summary>A titled run of fields, so a long panel reads as sections rather than one flat list.</summary>
public sealed record FilterGroupView
{
    public required string? Title { get; init; }
    public required IReadOnlyList<FilterFieldView> Fields { get; init; }
}

/// <summary>
/// Everything the panel partial renders. Built by <see cref="Build"/>, which is the only place condition
/// indexes are assigned — the partial never invents a field name, it asks a
/// <see cref="FilterConditionView"/> for one, so the markup and the binder stay in step.
/// </summary>
public sealed record FilterPanelViewModel
{
    public required FilterSchema Schema { get; init; }
    public required FilterQuery Query { get; init; }

    /// <summary>Where the panel posts. Supplied by the hosting page, never by this library.</summary>
    public required string Endpoint { get; init; }

    public required IReadOnlyList<FilterGroupView> Groups { get; init; }

    /// <summary>CSS selector the panel's response replaces (for a grid, its region element).</summary>
    public string Target { get; init; } = string.Empty;

    /// <summary>Extra selector whose fields ride along on every post — e.g. a grid's sort/column-order state.</summary>
    public string? Include { get; init; }

    /// <summary>Panel title; falls back to a generic label.</summary>
    public string Title { get; init; } = "Filters";

    /// <summary>
    /// Show the free-text search box above the fields. Off by default: unlike a condition, a search term
    /// has no generic translation — only the consuming application knows which fields it should span —
    /// so the box appears only once one has been wired up.
    /// </summary>
    public bool ShowSearch { get; init; }

    public string Id => Schema.Id;
    public int ActiveCount => Query.ActiveCount;
    public bool HasActive => ActiveCount > 0;

    /// <summary>
    /// Projects schema + current query into render-ready rows, assigning each condition a unique wire
    /// index. Every field gets its existing conditions followed by one empty slot, so the panel is
    /// always ready to accept another value without a round-trip; fields that allow stacking simply
    /// keep that spare slot after the first is filled.
    /// </summary>
    public static FilterPanelViewModel Build(FilterSchema schema, FilterQuery query, string endpoint)
    {
        ArgumentNullException.ThrowIfNull(schema);
        ArgumentNullException.ThrowIfNull(query);

        var index = 0;
        List<FilterFieldView> fields = [];

        foreach (var field in schema.Fields)
        {
            List<FilterConditionView> rows = [];

            foreach (var condition in query.For(field.Key))
                rows.Add(new FilterConditionView { Index = index++, Field = field, Condition = condition });

            if (rows.Count == 0 || field.AllowMultiple)
                rows.Add(new FilterConditionView { Index = index++, Field = field });

            fields.Add(new FilterFieldView { Field = field, Conditions = rows });
        }

        List<FilterGroupView> groups = [];
        foreach (var view in fields)
        {
            var title = string.IsNullOrWhiteSpace(view.Field.Group) ? null : view.Field.Group;
            if (groups.Count > 0 && groups[^1].Title == title)
                groups[^1] = groups[^1] with { Fields = [.. groups[^1].Fields, view] };
            else
                groups.Add(new FilterGroupView { Title = title, Fields = [view] });
        }

        return new FilterPanelViewModel
        {
            Schema = schema,
            Query = query,
            Endpoint = endpoint,
            Groups = groups,
        };
    }
}
