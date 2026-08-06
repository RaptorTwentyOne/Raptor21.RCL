namespace Raptor21.RCL.Grid;

/// <summary>The three URLs a grid posts to, server-rendered from the owning page's own route.</summary>
public readonly record struct GridEndpoints(string Region, string Block, string Cell)
{
    /// <summary>
    /// Derives the Block and Cell URLs from an explicit <c>Endpoint</c> by extending its path, leaving any
    /// query string or fragment where it belongs.
    /// <para>
    /// The server contract is a path suffix — a grid at <c>grid</c> pairs with <c>grid/cell</c> — so the
    /// suffix has to land before the <c>?</c>. Plain concatenation of an endpoint that carries a query
    /// string produces <c>/x/grid?key=1/cell</c>, which glues a path segment onto a query value and routes
    /// nowhere.
    /// </para>
    /// </summary>
    public static GridEndpoints FromBase(string endpoint) => new(
        Region: endpoint,
        Block: WithPathSuffix(endpoint, "/block"),
        Cell: WithPathSuffix(endpoint, "/cell"));

    /// <summary>
    /// Appends <paramref name="suffix"/> to the path portion of <paramref name="url"/>, keeping any query
    /// string or fragment after it.
    /// </summary>
    internal static string WithPathSuffix(string url, string suffix)
    {
        var cut = url.AsSpan().IndexOfAny('?', '#');
        return cut < 0
            ? url + suffix
            : string.Concat(url.AsSpan(0, cut), suffix, url.AsSpan(cut));
    }
}
