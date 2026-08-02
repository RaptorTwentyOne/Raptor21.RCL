namespace Raptor21.RCL.Grid;

/// <summary>
/// A screen's strongly-typed grid definition. Authored in C# by the page that owns the grid; every
/// column carries an expression-derived key and a typed cell renderer, so nothing here is reflected over
/// or looked up by a hand-written string.
/// </summary>
public sealed record GridView<TRow>
{
    /// <summary>Stable DOM id for the grid region (also used for the form / scroll container ids).</summary>
    public required string Id { get; init; }

    /// <summary>
    /// The columns, in definition order. Each carries an expression-derived key and a typed renderer.
    /// <para>
    /// There is no <c>Endpoint</c> here: the URLs the grid posts to are computed by the hosting page via
    /// <c>Url.Page(null, handler)</c>, so they resolve against that page's own route (including its route
    /// values) instead of whatever page happens to own the address bar.
    /// </para>
    /// </summary>
    public required IReadOnlyList<GridColumn<TRow>> Columns { get; init; }

    public int PageSize { get; init; } = 25;
    public int[] PageSizeOptions { get; init; } = [25, 50, 100];

    /// <summary>Expandable master-detail rows. <see cref="DetailUrl"/> is fetched on first expand.</summary>
    public bool MasterDetail { get; init; }

    /// <summary>URL template the detail row fetches, with <c>{key}</c> replaced by the row key.</summary>
    public string? DetailUrl { get; init; }

    /// <summary>Extra context values (e.g. a parent record id) round-tripped as hidden <c>ctx_*</c> inputs,
    /// so a nested grid can be parameterised by outer state.</summary>
    public IReadOnlyDictionary<string, string> ContextParams { get; init; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    /// <summary>Continuous (infinite) scroll instead of the pager.</summary>
    public bool VirtualScroll { get; init; }

    /// <summary>
    /// Extra CSS selector whose form fields ride along on every grid post. This is how an external
    /// control — a filter panel, a toolbar — contributes to the query without the grid having to know
    /// what it is: sorting or paging then preserves those values instead of dropping them.
    /// </summary>
    public string? Include { get; init; }

    /// <summary>Opt-in tighter row/header padding for dense screens.</summary>
    public bool Compact { get; init; }

    /// <summary>Leading checkbox selection column.</summary>
    public bool Selectable { get; init; }

    /// <summary>Where the card-mode filter drawer is opened from — the region's own floating action
    /// button (default) or the page shell's "…" menu. See <see cref="RaptorGridFilterEntry"/>.</summary>
    public RaptorGridFilterEntry FilterEntry { get; init; } = RaptorGridFilterEntry.Fab;

    /// <summary>
    /// Render the grid's shell without its first page, then let the browser fetch that page as a normal
    /// grid post once the markup is in the DOM.
    /// <para>
    /// By default the engine renders a grid's first page during the page request, so the rows arrive with
    /// the page and there is no spinner. When the source is slow, that blocks the whole page render.
    /// Deferring turns the first page into an ordinary asynchronous grid load, so a slow source delays
    /// only the grid area.
    /// </para>
    /// </summary>
    public bool DeferInitialLoad { get; init; }

    /// <summary>Permission required to view the grid's data.</summary>
    public string? ViewPermission { get; init; }

    /// <summary>Permission required to inline-edit an editable cell.</summary>
    public string? EditPermission { get; init; }

    /// <summary>Optional custom mobile card renderer — a typed list item shown instead of the automatic
    /// label:value fold when the grid collapses to cards on a narrow screen.</summary>
    public Func<TRow, GridCell>? Card { get; init; }
}
