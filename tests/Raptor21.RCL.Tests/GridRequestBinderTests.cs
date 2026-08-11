using Microsoft.Extensions.Primitives;
using Raptor21.RCL.Grid;
using Xunit;

namespace Raptor21.RCL.Tests;

/// <summary>
/// The slice of the binder the infinite-scroll sentinel depends on. A block request is the region form
/// plus two <c>hx-vals</c> overrides — <c>page</c> (the next block) and <c>block=1</c> (the branch marker
/// the REGION reads straight off the form, not through this binder) — so the binder must bind the
/// overridden page like any other page and let the unknown <c>block</c> field pass through without
/// touching the state.
/// </summary>
public sealed class GridRequestBinderTests
{
    private static readonly IReadOnlyDictionary<string, string> NoContext = new Dictionary<string, string>();

    private static GridQueryState Bind(params KeyValuePair<string, StringValues>[] form) =>
        new GridRequestBinder().Bind(form, columns: [], defaultPageSize: 25, NoContext);

    private static KeyValuePair<string, StringValues> Field(string key, string value) => new(key, value);

    [Fact]
    public void Page_binds_from_the_form_field()
    {
        var state = Bind(Field("page", "3"), Field("pageSize", "50"));

        Assert.Equal(3, state.Page);
        Assert.Equal(50, state.PageSize);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-2")]
    [InlineData("abc")]
    public void Page_falls_back_to_one_when_missing_or_invalid(string page) =>
        Assert.Equal(1, Bind(Field("page", page)).Page);

    [Fact]
    public void Page_defaults_to_one_without_the_field() =>
        Assert.Equal(1, Bind().Page);

    [Fact]
    public void Block_marker_rides_along_without_touching_the_state()
    {
        // The sentinel's exact payload shape: form state + page override + block marker.
        var state = Bind(Field("page", "4"), Field("block", "1"));

        Assert.Equal(4, state.Page);
        Assert.Empty(state.Filters);
        Assert.Empty(state.Sorts);
        Assert.Empty(state.ColumnOrder);
        // block is not a ctx_* param either — it must not leak into the round-tripped context.
        Assert.DoesNotContain("block", state.Params.Keys);
    }

    [Fact]
    public void Later_value_wins_when_a_field_repeats()
    {
        // htmx merges hx-vals over the included form, but a manual POST could carry both; the binder's
        // last-write-wins dictionary makes the override deterministic rather than order-dependent.
        var state = Bind(Field("page", "1"), Field("page", "5"));

        Assert.Equal(5, state.Page);
    }
}
