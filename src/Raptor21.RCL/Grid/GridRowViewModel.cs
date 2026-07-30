namespace Raptor21.RCL.Grid;

/// <summary>Everything the single-row partial (<c>_RaptorGridRow</c>) needs to emit one &lt;tr&gt; that
/// column-aligns with the live header. Used both by the full grid render and by inline-edit row swaps.</summary>
public sealed class GridRowViewModel
{
    public required string GridId { get; init; }
    public required IReadOnlyList<GridColumnView> Columns { get; init; }
    public required GridRow Row { get; init; }
    public bool Selectable { get; init; }

    /// <summary>The current user holds the grid's EditPermission — editable affordances render only then.</summary>
    public bool CanEdit { get; init; }

    /// <summary>Master-detail active — render a leading expand toggle + a collapsed detail row.</summary>
    public bool HasDetail { get; init; }

    /// <summary>Detail URL template (with <c>{key}</c>) the expand row htmx-fetches.</summary>
    public string? DetailUrl { get; init; }

    /// <summary>Colspan for the full-width detail row (data columns + selection + expand columns).</summary>
    public int SpanColumns => Columns.Count + (Selectable ? 1 : 0) + (HasDetail ? 1 : 0);
}
