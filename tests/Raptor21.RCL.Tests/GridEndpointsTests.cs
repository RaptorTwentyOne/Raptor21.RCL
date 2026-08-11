using Raptor21.RCL.Grid;
using Xunit;

namespace Raptor21.RCL.Tests;

/// <summary>
/// The endpoint-derivation contract the client rides on: a grid at <c>{Endpoint}</c> pairs with
/// <c>{Endpoint}/block</c>, <c>{Endpoint}/cell</c> and <c>{Endpoint}/reorder</c> as PATH suffixes — the
/// suffix must land before any query string or fragment, because <c>/x/grid?key=1/reorder</c> glues a
/// path segment onto a query value and routes nowhere. The Razor Pages shape instead dispatches through
/// the handler name (<c>?handler={Handler}Reorder</c> → <c>OnPost{Handler}ReorderAsync</c>); these tests
/// pin both shapes so a rename on either side cannot drift silently.
/// </summary>
public sealed class GridEndpointsTests
{
    [Fact]
    public void FromBase_derives_the_three_suffixed_endpoints()
    {
        var endpoints = GridEndpoints.FromBase("/admin/users/grid");

        Assert.Equal("/admin/users/grid", endpoints.Region);
        Assert.Equal("/admin/users/grid/block", endpoints.Block);
        Assert.Equal("/admin/users/grid/cell", endpoints.Cell);
        Assert.Equal("/admin/users/grid/reorder", endpoints.Reorder);
    }

    [Fact]
    public void FromBase_puts_the_suffix_before_a_query_string()
    {
        var endpoints = GridEndpoints.FromBase("/x/grid?key=1&tab=all");

        Assert.Equal("/x/grid?key=1&tab=all", endpoints.Region);
        Assert.Equal("/x/grid/reorder?key=1&tab=all", endpoints.Reorder);
        Assert.Equal("/x/grid/block?key=1&tab=all", endpoints.Block);
        Assert.Equal("/x/grid/cell?key=1&tab=all", endpoints.Cell);
    }

    [Fact]
    public void FromBase_puts_the_suffix_before_a_fragment() =>
        Assert.Equal("/x/grid/reorder#rows", GridEndpoints.FromBase("/x/grid#rows").Reorder);

    [Fact]
    public void ForPageHandlers_dispatches_through_the_handler_name()
    {
        var endpoints = GridEndpoints.ForPageHandlers("/admin/users", "Grid");

        Assert.Equal("/admin/users?handler=Grid", endpoints.Region);
        Assert.Equal("/admin/users?handler=GridBlock", endpoints.Block);
        Assert.Equal("/admin/users?handler=GridCell", endpoints.Cell);
        Assert.Equal("/admin/users?handler=GridReorder", endpoints.Reorder);
    }
}
