namespace Raptor21.RCL.Grid;

/// <summary>A row reduced to its rendered cells plus a stable key. Column order matches
/// <see cref="GridViewModel.Columns"/>. <paramref name="CardHtml"/> is the pre-rendered custom mobile
/// card (only when the grid supplies a card renderer — <c>GridView&lt;TRow&gt;.Card</c> or the
/// <c>&lt;CardTemplate&gt;</c> markup twin); null otherwise.</summary>
public sealed record GridRow(string Key, IReadOnlyList<GridCell> Cells, string? CardHtml = null);

/// <summary>
/// Everything the <c>_RaptorGrid</c> partial needs to draw the grid: the permission-filtered columns,
/// the current page of pre-rendered rows, the request state (for sticky sort/filter inputs) and the
/// pager math. Built by <see cref="RaptorGridBuilder"/>; consumed by the grid partials on the initial
/// render and on every htmx swap.
/// </summary>
public sealed class GridViewModel
{
    public required string GridId { get; init; }

    /// <summary>htmx POST target for filter/sort/page changes — the hosting page's own handler,
    /// server-rendered via <c>Url.Page(null, "Grid")</c>.</summary>
    public required string Endpoint { get; init; }

    /// <summary>POST target for a virtual-scroll block append. Null falls back to <see cref="BlockUrl"/>.</summary>
    public string? BlockEndpoint { get; init; }

    /// <summary>POST target for an inline cell edit. Null falls back to <see cref="CellUrl"/>.</summary>
    public string? CellEndpoint { get; init; }

    /// <summary>Block endpoint, defaulting to <see cref="Endpoint"/>'s path plus <c>/block</c>.</summary>
    public string BlockUrl => BlockEndpoint ?? GridEndpoints.WithPathSuffix(Endpoint, "/block");

    /// <summary>Cell endpoint, defaulting to <see cref="Endpoint"/>'s path plus <c>/cell</c>.</summary>
    public string CellUrl => CellEndpoint ?? GridEndpoints.WithPathSuffix(Endpoint, "/cell");

    /// <summary>Columns the current user may see (permission-filtered), already projected to the
    /// non-generic view shape — the partials never see the typed definition or the row type.</summary>
    public required IReadOnlyList<GridColumnView> Columns { get; init; }

    public required IReadOnlyList<GridRow> Rows { get; init; }

    public required GridQueryState State { get; init; }

    public required int TotalCount { get; init; }
    public required int TotalPages { get; init; }
    public required int[] PageSizeOptions { get; init; }

    public bool MasterDetail { get; init; }

    /// <summary>URL template (with <c>{key}</c>) the detail row htmx-fetches.</summary>
    public string? DetailUrl { get; init; }

    /// <summary>Master-detail is active (enabled + a detail URL is configured).</summary>
    public bool HasDetail => MasterDetail && !string.IsNullOrEmpty(DetailUrl);

    /// <summary>Continuous (infinite) scroll mode instead of the pager.</summary>
    public bool VirtualScroll { get; init; }

    /// <summary>Extra selector appended to the form's hx-include (see GridView&lt;TRow&gt;.Include).</summary>
    public string? Include { get; init; }

    public string VirtualScrollHeight { get; init; } = "60vh";

    /// <summary>More blocks remain to load (virtual scroll sentinel + pager next enabled).</summary>
    public bool HasMore => State.PageSize > 0 && State.Page * State.PageSize < TotalCount;

    public int NextPage => State.Page + 1;

    /// <summary>Leading checkbox selection column enabled.</summary>
    public bool Selectable { get; init; }

    /// <summary>Where the card-mode filter drawer is opened from. See <see cref="RaptorGridFilterEntry"/>.</summary>
    public RaptorGridFilterEntry FilterEntry { get; init; } = RaptorGridFilterEntry.Fab;

    /// <summary>
    /// This render is the shell of a deferred grid: no rows yet, and the region posts to its own handler
    /// on <c>load</c> to fetch the first page. See <c>GridView&lt;T&gt;.DeferInitialLoad</c>.
    /// </summary>
    public bool Deferred { get; init; }

    /// <summary>Current user holds the grid's EditPermission — editable cell affordances render only then.</summary>
    public bool CanEdit { get; init; }

    /// <summary>Total columns rendered including the selection + expand columns, for colspans.</summary>
    public int SpanColumns => Columns.Count + (Selectable ? 1 : 0) + (HasDetail ? 1 : 0);

    /// <summary>Any column carries a group header — the grid renders a two-row (grouped) header.</summary>
    public bool HasColumnGroups => Columns.Any(c => !string.IsNullOrEmpty(c.Group));

    /// <summary>The grid supplies a custom mobile card (<c>GridView&lt;TRow&gt;.Card</c> or the
    /// <c>&lt;CardTemplate&gt;</c> markup twin) — card mode shows that list item instead of the automatic
    /// label:value fold.</summary>
    public bool HasCards { get; init; }

    /// <summary>Tighter vertical rhythm (see <see cref="GridView{TRow}.Compact"/>).</summary>
    public bool Compact { get; init; }

    /// <summary>
    /// Whether the grid itself is filtered — used to explain an empty result. This sees only the column
    /// funnels; filters contributed by an external panel never enter <see cref="State"/>.
    /// </summary>
    public bool HasActiveFilters => State.Filters.Count > 0;

    /// <summary>Current single-sort field, or null.</summary>
    public string? SortField { get; init; }

    /// <summary>"asc" | "desc".</summary>
    public string SortDir { get; init; } = "asc";

    /// <summary>Single-value text/number/date filter values, keyed by field, for sticky inputs.</summary>
    public required IReadOnlyDictionary<string, string> FilterValues { get; init; }

    /// <summary>Current filter operation key (e.g. "contains", "greaterThan") per field, so the header
    /// popup restores the chosen operation on load/deep-link.</summary>
    public required IReadOnlyDictionary<string, string> FilterOps { get; init; }

    /// <summary>Selected values per Set-filter field, so the checkbox popup restores checked state and
    /// the funnel shows active.</summary>
    public required IReadOnlyDictionary<string, IReadOnlyCollection<string>> SetSelections { get; init; }

    public int FirstRowNumber => TotalCount == 0 ? 0 : (State.Page - 1) * State.PageSize + 1;
    public int LastRowNumber => Math.Min(State.Page * State.PageSize, TotalCount);

    /// <summary>The applied data-column order (non-pinned field names) as a CSV, echoed in a hidden
    /// input so the client's reorder preference round-trips on every request.</summary>
    public string ColumnOrderCsv => string.Join(",", Columns.Where(c => c.Pinned is null).Select(c => c.Key));
}