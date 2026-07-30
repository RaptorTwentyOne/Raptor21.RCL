namespace Raptor21.RCL.Grid;

/// <summary>
/// The non-generic projection of a <see cref="GridColumn{TRow}"/> that the Razor partials render.
/// <para>
/// All typing lives in the definition and the build step (expression-derived keys,
/// <c>Func&lt;TRow, GridCell&gt;</c> renderers); by the time markup is produced every cell is already
/// finished HTML. The partials therefore need no generics and never touch the row object.
/// </para>
/// </summary>
public sealed record GridColumnView
{
    /// <summary>Wire/backend identifier (derived from the column's member expression upstream).</summary>
    public required string Key { get; init; }

    public required string Header { get; init; }

    public GridFilterType Filter { get; init; } = GridFilterType.None;
    public bool Sortable { get; init; }

    public int? Width { get; init; }
    public int? Flex { get; init; }
    public int? MinWidth { get; init; }

    /// <summary>"left" | "right" | null.</summary>
    public string? Pinned { get; init; }

    /// <summary>Column-group header for the two-row grouped header.</summary>
    public string? Group { get; init; }

    public string? CssClass { get; init; }

    /// <summary>"left" | "center" | "right".</summary>
    public string? Align { get; init; }

    public bool Wrap { get; init; }

    public IReadOnlyList<GridSetOption>? SetOptions { get; init; }
    public GridFilterDataType SetDataType { get; init; } = GridFilterDataType.Text;

    public bool Editable { get; init; }
    public string? Editor { get; init; }

    /// <summary>
    /// Projects a typed column down to what the view needs. A column's declared filter is carried across
    /// even when it has no compiled accessor, so a display-only column can still map to a server-side
    /// filter; sorting additionally requires a bound member.
    /// </summary>
    public static GridColumnView From<TRow>(GridColumn<TRow> column) => new()
    {
        Key = column.Key,
        Header = column.Header,
        Filter = column.Filter,
        Sortable = column.IsBound && column.Sortable,
        Width = column.Width,
        Flex = column.Flex,
        MinWidth = column.MinWidth,
        Pinned = column.Pinned,
        Group = column.Group,
        CssClass = column.CssClass,
        Align = column.Align,
        Wrap = column.Wrap,
        SetOptions = column.SetOptions,
        SetDataType = column.SetDataType,
        Editable = column.Editable,
        Editor = column.Editor,
    };
}
