using Microsoft.AspNetCore.Http;

namespace Raptor21.RCL.Filtering;

/// <summary>
/// Binds the current filter state straight off the <see cref="HttpContext"/> — the RaptorPage seam.
/// A <c>RaptorPage</c> handler binds the posted form; the panel component binds the query string on the
/// first GET.
/// </summary>
public static class FilterQueryHttpContextExtensions
{
    private static readonly FilterQueryBinder Binder = new();

    /// <summary>Reads the current filter state off the request (form on post, query string on first load).</summary>
    public static FilterQuery BindFilterQuery(this HttpContext http, FilterSchema schema)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(schema);

        var request = http.Request;
        return request.HasFormContentType
            ? Binder.Bind(request.Form, schema)
            : Binder.Bind(request.Query, schema);
    }
}
