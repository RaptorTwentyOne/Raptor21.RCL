using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Raptor21.RCL.Filtering;

/// <summary>
/// A page that can be filtered. The page declares <i>what</i> is filterable; where the values go
/// (SQL, Elastic, an in-memory list) is entirely the page's business.
/// </summary>
public interface IFilterSource
{
    FilterSchema BuildFilterSchema();
}

/// <summary>
/// The filter's page seam, mirroring <c>RaptorGridPageExtensions</c>: this library ships no controller
/// and no routes, so the panel posts back to a handler on the page that owns it. The endpoint is
/// computed with <c>IUrlHelper.Page(string?, string?)</c>, which keeps the page's ambient route values,
/// so a panel on a nested or parameterized page still posts to that page.
/// </summary>
public static class RaptorFilterPageExtensions
{
    private static readonly FilterQueryBinder Binder = new();

    /// <summary>Reads the current filter state off the request (form on post, query string on first load).</summary>
    public static FilterQuery BindFilterQuery(this PageModel page, FilterSchema schema)
    {
        ArgumentNullException.ThrowIfNull(page);
        ArgumentNullException.ThrowIfNull(schema);

        var request = page.Request;
        return request.HasFormContentType
            ? Binder.Bind(request.Form, schema)
            : Binder.Bind(request.Query, schema);
    }

    /// <inheritdoc cref="BindFilterQuery(PageModel, FilterSchema)"/>
    public static FilterQuery BindFilterQuery(this PageModel page, IFilterSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        return page.BindFilterQuery(source.BuildFilterSchema());
    }

    /// <summary>
    /// Reads the current filter state straight off an <see cref="HttpContext"/> — the RaptorPage seam, where
    /// there is no <see cref="PageModel"/>. A <c>RaptorPage</c> handler binds the posted form; the panel
    /// component binds the query string on the first GET.
    /// </summary>
    public static FilterQuery BindFilterQuery(this HttpContext http, FilterSchema schema)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(schema);

        var request = http.Request;
        return request.HasFormContentType
            ? Binder.Bind(request.Form, schema)
            : Binder.Bind(request.Query, schema);
    }

    /// <summary>
    /// Builds the panel view model, resolving the post endpoint from the page's own handler.
    /// <paramref name="target"/> is the CSS selector the response replaces (for a grid, its region);
    /// <paramref name="include"/> lets sibling state — a grid's sort and column order — ride along so a
    /// filter change does not reset it.
    /// </summary>
    public static FilterPanelViewModel BuildFilterPanel(
        this PageModel page,
        IFilterSource source,
        string target,
        string? include = null,
        string? handler = null)
    {
        ArgumentNullException.ThrowIfNull(page);
        ArgumentNullException.ThrowIfNull(source);

        var schema = source.BuildFilterSchema();
        var query = page.BindFilterQuery(schema);
        var endpoint = page.Url.Page(null, handler ?? FilterHandler) ?? string.Empty;

        return FilterPanelViewModel.Build(schema, query, endpoint) with
        {
            Target = target,
            Include = include,
        };
    }

    /// <summary>Default handler name a page exposes for the panel (<c>OnPostFilterAsync</c>).</summary>
    public const string FilterHandler = "Filter";
}

/// <summary>Partial paths, so consumers don't hard-code view locations.</summary>
public static class RaptorFilterPartials
{
    public const string Panel = "Filtering/_RaptorFilter";
}