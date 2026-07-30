namespace Raptor21.RCL.Grid.Markup;

/// <summary>
/// The hand-off between the (headless) Blazor column-def render and the Razor Page that owns the grid.
/// <para>
/// The page renders its <see cref="RaptorGridColumns{TRow}"/> component once per request via
/// <see cref="RaptorMarkupGrid"/>; the component drops its collector plus the grid-level config here —
/// same request scope — and the page reads them straight back as a finished <see cref="GridView{TRow}"/>.
/// Every other part of the grid (the <c>&lt;raptor-grid&gt;</c> facade, the <c>OnPostGridAsync</c> handler,
/// the region partial, the htmx wiring) is identical to the fluent path; only where the columns are
/// authored differs.
/// </para>
/// Scoped, so there is exactly one instance per request.
/// </summary>
public sealed class RaptorMarkupGridSink
{
    /// <summary>Boxed <see cref="RaptorColumnCollector{TRow}"/> — filled while the column-def component renders.</summary>
    public object? Collector { get; set; }

    /// <summary>Grid-level options declared on the <see cref="RaptorGridColumns{TRow}"/> element.</summary>
    public GridViewConfig? Config { get; set; }

    /// <summary>Assemble the finished view once the render has populated <see cref="Collector"/>.</summary>
    public GridView<TRow> BuildView<TRow>()
    {
        if (Collector is not RaptorColumnCollector<TRow> collector)
            throw new InvalidOperationException(
                $"No <RaptorGridColumns TRow=\"{typeof(TRow).Name}\"> was rendered for this request. " +
                "Call RaptorMarkupGrid.BuildViewAsync<TColumns, TRow>() from the page handler first.");

        var cfg = Config ?? throw new InvalidOperationException("Grid config missing from the column-def render.");

        return new GridView<TRow>
        {
            Id = cfg.Id,
            Columns = [.. collector.Columns],
            PageSize = cfg.PageSize,
            PageSizeOptions = cfg.PageSizeOptions,
            MasterDetail = cfg.MasterDetail,
            DetailUrl = cfg.DetailUrl,
            Compact = cfg.Compact,
            Selectable = cfg.Selectable,
            VirtualScroll = cfg.VirtualScroll,
            Include = cfg.Include,
            ViewPermission = cfg.ViewPermission,
            EditPermission = cfg.EditPermission,
            DeferInitialLoad = cfg.DeferInitialLoad,
        };
    }
}

/// <summary>Grid-level options captured from the <see cref="RaptorGridColumns{TRow}"/> markup element.</summary>
public sealed record GridViewConfig(
    string Id,
    int PageSize,
    int[] PageSizeOptions,
    bool MasterDetail,
    string? DetailUrl,
    bool Compact,
    bool Selectable,
    bool VirtualScroll,
    string? Include,
    string? ViewPermission,
    string? EditPermission,
    bool DeferInitialLoad);
