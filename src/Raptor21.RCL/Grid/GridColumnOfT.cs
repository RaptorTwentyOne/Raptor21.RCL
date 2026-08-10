using System.Linq.Expressions;

namespace Raptor21.RCL.Grid;

public enum GridFilterType { None, Text, Number, Set, Date }

/// <summary>One option in a Set filter: the value posted to the server and the label shown in the popup.</summary>
public sealed record GridSetOption(string Value, string Label);

/// <summary>
/// Strongly-typed grid column definition.
/// <para>
/// A column's <see cref="Key"/> is what travels on the wire (sort / filter / column-order form fields,
/// DOM attributes) and what the data provider maps to a backing store column. <see cref="For{TValue}"/>
/// derives that key from a member expression, so <c>o =&gt; o.OrderNumber</c> yields the key
/// "OrderNumber" and renaming the property becomes a compile error rather than a runtime mismatch. The
/// same expression is compiled once into a typed accessor, so rendering never reflects over the row.
/// </para>
/// <para>
/// Columns with no backing member (actions, chrome) use <see cref="Display"/>; they cannot be sorted or
/// filtered because there is nothing on the backend to map them to.
/// </para>
/// <example>
/// <code>
/// GridColumn&lt;OrderDto&gt;.For(o =&gt; o.OrderNumber, "Order Number") with
/// {
///     Filter = GridFilterType.Text, MinWidth = 150, Pinned = "left",
///     Cell = o =&gt; GridCell.Text(o.OrderNumber)
/// }
/// </code>
/// </example>
/// </summary>
public sealed record GridColumn<TRow>
{
    private GridColumn(string key, Func<TRow, object?>? value, string header)
    {
        Key = key;
        Value = value;
        Header = header;
    }

    /// <summary>Wire/backend identifier, derived from the selector expression (never hand-written for data columns).</summary>
    public string Key { get; private init; }

    /// <summary>Compiled typed accessor for the bound member; null for display-only columns.</summary>
    public Func<TRow, object?>? Value { get; private init; }

    /// <summary>True when bound to a member, and therefore sortable/filterable server-side.</summary>
    public bool IsBound => Value is not null;

    public string Header { get; init; }

    /// <summary>Typed cell renderer. Null = the bound member's value as HTML-encoded text.</summary>
    public Func<TRow, GridCell>? Cell { get; init; }

    public GridFilterType Filter { get; init; } = GridFilterType.None;
    public bool Sortable { get; init; }

    /// <summary>Column is emitted only if the current user holds this permission (resolved server-side).</summary>
    public string? Permission { get; init; }

    public int? Width { get; init; }
    public int? Flex { get; init; }
    public int? MinWidth { get; init; }

    /// <summary>"left" | "right" | null — sticky pinned side.</summary>
    public string? Pinned { get; init; }

    /// <summary>Column-group header; consecutive columns sharing a group render under one spanning header.</summary>
    public string? Group { get; init; }

    /// <summary>Extra CSS class on the cell.</summary>
    public string? CssClass { get; init; }

    /// <summary>"left" | "center" | "right".</summary>
    public string? Align { get; init; }

    /// <summary>Cell wraps (auto-height) instead of truncating on one line.</summary>
    public bool Wrap { get; init; }

    /// <summary>Fixed options for a <see cref="GridFilterType.Set"/> filter.</summary>
    public IReadOnlyList<GridSetOption>? SetOptions { get; init; }

    /// <summary>
    /// Key of a registered <see cref="IGridSetOptionsProvider"/> whose options populate this Set filter at
    /// render time. Use this instead of <see cref="SetOptions"/> when the choices are dynamic / per-user
    /// (e.g. the values the current user is permitted to see) and so cannot be known in the synchronous
    /// <see cref="IGridSource{TRow}.BuildView"/>. The builder resolves the provider asynchronously and fills
    /// <see cref="SetOptions"/> before the filter popup is rendered. If both are set, the resolved options win.
    /// </summary>
    public string? SetOptionsKey { get; init; }

    /// <summary>Data type used when binding a Set filter's selected values.</summary>
    public GridFilterDataType SetDataType { get; init; } = GridFilterDataType.Text;

    /// <summary>Cell is inline-editable (gated by the grid's edit permission).</summary>
    public bool Editable { get; init; }

    /// <summary>Inline editor kind ("text"). Null when not editable.</summary>
    public string? Editor { get; init; }

    /// <summary>
    /// A data column bound to a member — the key and the accessor are both derived from
    /// <paramref name="selector"/>, so no key string is ever hand-written.
    /// </summary>
    public static GridColumn<TRow> For<TValue>(Expression<Func<TRow, TValue>> selector, string header)
    {
        ArgumentNullException.ThrowIfNull(selector);
        var member = Member(selector);
        return new GridColumn<TRow>(member.Name, AccessorCache.GetOrAdd(member, BuildAccessor), header);
    }

    // Column definitions are rebuilt on EVERY grid render (IGridSource<TRow>.BuildView runs per request), and
    // each expression tree is a fresh instance — so caching by expression is impossible and compiling in For()
    // meant one Compile() per column per request. The selector is constrained to a simple member access, so the
    // MEMBER is the whole identity: one compiled accessor per (TRow, member) for the process lifetime.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<System.Reflection.MemberInfo, Func<TRow, object?>>
        AccessorCache = new();

    private static Func<TRow, object?> BuildAccessor(System.Reflection.MemberInfo member)
    {
        var row = Expression.Parameter(typeof(TRow), "row");
        var body = Expression.Convert(Expression.MakeMemberAccess(row, member), typeof(object));
        return Expression.Lambda<Func<TRow, object?>>(body, row).Compile();
    }

    /// <summary>
    /// A display-only column with no backing member (actions, chrome). <paramref name="name"/> is used
    /// purely for DOM / column-order identity; such a column cannot be sorted or filtered.
    /// </summary>
    public static GridColumn<TRow> Display(string name, string header = "")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        return new GridColumn<TRow>(name, null, header);
    }

    private static System.Reflection.MemberInfo Member<TValue>(Expression<Func<TRow, TValue>> selector) => selector.Body switch
    {
        MemberExpression m => m.Member,
        UnaryExpression { Operand: MemberExpression m } => m.Member,
        _ => throw new ArgumentException(
            "Column selector must be a simple member access (e.g. o => o.OrderNumber). " +
            "For computed / action columns use GridColumn<T>.Display(name).", nameof(selector))
    };
}
