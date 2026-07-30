using System.Collections.Concurrent;
using System.Reflection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Primitives;

namespace Raptor21.RCL.Grid;

/// <summary>
/// The endpoint-less grid seam: a Razor Page that owns a grid calls these from its own handlers.
/// <para>
/// The library registers no routes in the consuming application. The only endpoints are the page's own
/// handlers — they appear as <c>?handler=Grid</c> on that page's route, are visible in the page's own
/// source, and vanish with it.
/// </para>
/// <para>
/// Endpoints are produced with <c>IUrlHelper.Page(pageName, pageHandler)</c>, which preserves the
/// current page's ambient route values. That matters for nested grids: a grid hosted on a parameterised
/// route such as <c>/orders/detail/{orderId:guid}</c> posts back to <i>its own</i> route rather than to
/// whatever page happens to own the address bar.
/// </para>
/// <example>
/// <code>
/// public Task&lt;IActionResult&gt; OnPostGridAsync(CancellationToken ct) =&gt; this.GridPartialAsync(this, ct);
/// </code>
/// </example>
/// </summary>
public static class RaptorGridPageExtensions
{
    /// <summary>Handler names the grid posts to. Pages expose them as OnPost{Name}Async.</summary>
    public const string GridHandler = "Grid";

    public const string BlockHandler = "GridBlock";
    public const string CellHandler = "GridCell";

    /// <summary>
    /// Builds the grid for the initial (GET) render. Call from the page's <c>.cshtml</c>:
    /// <c>@await Html.PartialAsync(RaptorGridPartials.Region, await Model.BuildGridAsync(Model))</c>.
    /// Deep-link state (sort/filter/page in the query string) is honoured.
    /// <para>
    /// This overload posts to the default <c>Grid</c> handler (i.e. <c>OnPostGridAsync</c>). A page that
    /// hosts more than one grid uses the overload below to give each grid a distinct handler
    /// (<c>ContactsGrid</c> → <c>OnPostContactsGridAsync</c>) so their posts do not collide. The
    /// block/cell handlers are derived as <c>{handler}Block</c> / <c>{handler}Cell</c>, which for the
    /// default yields <c>GridBlock</c> / <c>GridCell</c>.
    /// </para>
    /// </summary>
    public static Task<GridViewModel> BuildGridAsync<TRow>(
        this PageModel page, IGridSource<TRow> source, CancellationToken ct = default) =>
        page.BuildGridAsync(source, GridHandler, ct);

    /// <summary>
    /// Multi-grid overload: builds a grid that posts to a named page handler rather than the default
    /// <c>Grid</c>. A page that hosts more than one grid gives each grid a distinct handler
    /// (<c>ContactsGrid</c> → <c>OnPostContactsGridAsync</c>) so their posts do not collide. Block/cell
    /// handlers are derived as <c>{handler}Block</c> / <c>{handler}Cell</c>.
    /// </summary>
    public static Task<GridViewModel> BuildGridAsync<TRow>(
        this PageModel page, IGridSource<TRow> source, string handler, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(page);
        ArgumentNullException.ThrowIfNull(source);

        var builder = page.HttpContext.RequestServices.GetRequiredService<RaptorGridBuilder>();

        var deferred = source.BuildView().DeferInitialLoad && HttpMethods.IsGet(page.Request.Method);

        return builder.BuildAsync(source, RequestValues(page), Endpoints(page, handler), ct, deferred);
    }

    /// <summary>
    /// Non-generic overload for the declarative <c>&lt;raptor-grid&gt;</c> facade, where the row type is
    /// not known at the call site: the tag helper holds the source as <see cref="object"/> and cannot name
    /// <c>TRow</c>. This finds <c>IGridSource&lt;TRow&gt;</c> on the source and dispatches to the generic
    /// build above. The <see cref="MethodInfo"/> is cached per row type, so the one-time cost is a
    /// dictionary lookup — the strongly-typed <c>BuildGridAsync&lt;TRow&gt;</c> stays reflection-free for
    /// pages that call it directly.
    /// </summary>
    public static Task<GridViewModel> BuildGridAsync(
        this PageModel page, object source, string handler = GridHandler, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(page);
        ArgumentNullException.ThrowIfNull(source);

        var build = TypedBuildFor(source.GetType());
        return (Task<GridViewModel>)build.Invoke(null, [page, source, handler, ct])!;
    }

    private static readonly ConcurrentDictionary<Type, MethodInfo> TypedBuildCache = new();

    private static MethodInfo TypedBuildFor(Type sourceType) => TypedBuildCache.GetOrAdd(sourceType, static type =>
    {
        var gridSource = Array.Find(type.GetInterfaces(),
                             i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IGridSource<>))
                         ?? throw new ArgumentException($"{type.Name} does not implement IGridSource<TRow>.", nameof(sourceType));

        var rowType = gridSource.GetGenericArguments()[0];
        var open = Array.Find(typeof(RaptorGridPageExtensions).GetMethods(BindingFlags.Public | BindingFlags.Static),
            m => m is { Name: nameof(BuildGridAsync), IsGenericMethodDefinition: true } && m.GetParameters().Length == 4)!;
        return open.MakeGenericMethod(rowType);
    });

    /// <summary>
    /// The grid's POST handler result — returns the swapped region partial.
    /// Enforces the view's <see cref="GridView{TRow}.ViewPermission"/>.
    /// </summary>
    public static Task<IActionResult> GridPartialAsync<TRow>(
        this PageModel page, IGridSource<TRow> source, CancellationToken ct = default) =>
        page.GridPartialAsync(source, GridHandler, ct);

    /// <summary>
    /// Multi-grid overload of <see cref="GridPartialAsync{TRow}(PageModel, IGridSource{TRow}, CancellationToken)"/>.
    /// <paramref name="handler"/> must match the one passed to <see cref="BuildGridAsync"/> so the
    /// re-rendered region keeps posting to this same handler.
    /// </summary>
    public static Task<IActionResult> GridPartialAsync<TRow>(
        this PageModel page, IGridSource<TRow> source, string handler, CancellationToken ct = default) =>
        RunAsync(ct, async () =>
        {
            if (!await IsAuthorizedAsync(page, source, ct)) return new ForbidResult();
            var model = await page.BuildGridAsync(source, handler, ct);
            return page.Partial(RaptorGridPartials.Region, model);
        });

    /// <summary>Virtual-scroll block append — returns the rows-plus-sentinel fragment.</summary>
    public static Task<IActionResult> GridBlockPartialAsync<TRow>(
        this PageModel page, IGridSource<TRow> source, CancellationToken ct = default) =>
        page.GridBlockPartialAsync(source, GridHandler, ct);

    /// <summary>Multi-grid overload of the virtual-scroll block append.</summary>
    public static Task<IActionResult> GridBlockPartialAsync<TRow>(
        this PageModel page, IGridSource<TRow> source, string handler, CancellationToken ct = default) =>
        RunAsync(ct, async () =>
        {
            if (!await IsAuthorizedAsync(page, source, ct)) return new ForbidResult();
            var model = await page.BuildGridAsync(source, handler, ct);
            return page.Partial(RaptorGridPartials.Block, model);
        });

    /// <summary>
    /// Inline cell edit — patches one field and returns the refreshed row. Enforces the grid's
    /// <see cref="GridView{TRow}.EditPermission"/>; a 422 carries the validation message the client
    /// re-opens the editor with. Only an <see cref="IGridEditableSource{TRow}"/> can be passed here, so a
    /// read-only grid cannot expose this handler at all.
    /// </summary>
    public static Task<IActionResult> GridCellPartialAsync<TRow>(
        this PageModel page, IGridEditableSource<TRow> source, CancellationToken ct = default) =>
        RunAsync(ct, async () =>
        {
            var view = source.BuildView();
            var services = page.HttpContext.RequestServices;
            var user = services.GetRequiredService<IGridUserContext>();

            if (view.EditPermission is null) return new ForbidResult();
            var authorization = services.GetRequiredService<IGridAuthorization>();
            if (!await authorization.HasPermissionAsync(user.UserId, view.EditPermission, ct)) return new ForbidResult();

            var form = page.HttpContext.Request.Form;
            var rowKey = form["rowKey"].ToString();
            var columnKey = form["field"].ToString();
            var value = form["value"].ToString();

            var column = view.Columns.FirstOrDefault(c =>
                c.Editable && string.Equals(c.Key, columnKey, StringComparison.OrdinalIgnoreCase));
            if (column is null)
                return new ContentResult { StatusCode = 422, Content = "This field cannot be edited inline." };

            var result = await source.UpdateCellAsync(rowKey, columnKey, value, user.UserId, ct);
            if (!result.Success || result.Row is null)
                return new ContentResult { StatusCode = 422, Content = result.Error ?? "Update failed." };

            var builder = services.GetRequiredService<RaptorGridBuilder>();
            var model = await builder.BuildRowAsync(source, result.Row, form, ct);
            return page.Partial(RaptorGridPartials.Row, model);
        });

    /// <summary>
    /// Runs a grid POST handler, treating a client-aborted request as a no-op instead of a server error.
    /// htmx cancels the in-flight request whenever a newer one supersedes it — a second filter keystroke,
    /// a sort while the first page is still loading — which surfaces as an
    /// <see cref="OperationCanceledException"/> whose response nobody is waiting for; that case returns an
    /// empty result. A cancellation that is not the request being aborted is rethrown.
    /// </summary>
    private static async Task<IActionResult> RunAsync(CancellationToken ct, Func<Task<IActionResult>> handler)
    {
        try
        {
            return await handler();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return new EmptyResult();
        }
    }

    /// <summary>
    /// Derives the three handler URLs from the base handler name, so one page can carry several grids
    /// (each with its own <c>{handler}</c> / <c>{handler}Block</c> / <c>{handler}Cell</c> trio) without
    /// their posts colliding.
    /// </summary>
    private static GridEndpoints Endpoints(PageModel page, string handler) => new(
        Region: page.Url.Page(null, handler) ?? string.Empty,
        Block: page.Url.Page(null, handler + "Block") ?? string.Empty,
        Cell: page.Url.Page(null, handler + "Cell") ?? string.Empty);

    /// <summary>htmx posts a form; the first (GET) render reads the query string.</summary>
    private static IEnumerable<KeyValuePair<string, StringValues>> RequestValues(PageModel page) =>
        page.HttpContext.Request.HasFormContentType
            ? page.HttpContext.Request.Form
            : page.HttpContext.Request.Query;

    private static async Task<bool> IsAuthorizedAsync<TRow>(PageModel page, IGridSource<TRow> source, CancellationToken ct)
    {
        var permission = source.BuildView().ViewPermission;
        if (permission is null) return true;

        var services = page.HttpContext.RequestServices;
        var authorization = services.GetRequiredService<IGridAuthorization>();
        var user = services.GetRequiredService<IGridUserContext>();
        return await authorization.HasPermissionAsync(user.UserId, permission, ct);
    }
}

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
    /// string or fragment after it. Shared with <see cref="GridViewModel.BlockUrl"/> /
    /// <see cref="GridViewModel.CellUrl"/> so both ways of deriving a sub-endpoint agree.
    /// </summary>
    internal static string WithPathSuffix(string url, string suffix)
    {
        var cut = url.AsSpan().IndexOfAny('?', '#');
        return cut < 0
            ? url + suffix
            : string.Concat(url.AsSpan(0, cut), suffix, url.AsSpan(cut));
    }
}

/// <summary>Partial view names shipped by the library, so pages never hard-code a view path.</summary>
public static class RaptorGridPartials
{
    /// <summary>The full grid region (header, body, footer, filter drawer).</summary>
    public const string Region = "Grid/_RaptorGrid";

    /// <summary>Rows + sentinel fragment appended during virtual scroll.</summary>
    public const string Block = "Grid/_RaptorGridBlock";

    /// <summary>A single row — used for inline-edit row swaps.</summary>
    public const string Row = "Grid/_RaptorGridRow";
}