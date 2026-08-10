using Raptor21.RCL.SourceGenerators;
using Xunit;

namespace Raptor21.RCL.Tests;

/// <summary>
/// The .razor markup scan behind the modal-link emission (RFC 0001 Part 2(b)). The scan is a tag-level
/// regex by design, so these tests pin exactly what it promises: literal ids in first-seen order, razor
/// expressions and empties skipped, and the id → class-name conversion refusing anything that cannot form
/// an identifier rather than guessing.
/// </summary>
public sealed class MarkupScanTests
{
    [Fact]
    public void Finds_literal_ids_in_first_seen_order_without_duplicates()
    {
        const string markup =
            """
            <RaptorButton data-rg-modal-link="user-edit" hx-get="/modals/user">Edit</RaptorButton>
            <a data-rg-modal-link = "user-create">New</a>
            <RaptorButton data-rg-modal-link="user-edit">Edit again</RaptorButton>
            """;

        Assert.Equal(["user-edit", "user-create"], MarkupScan.ModalLinkIds(markup));
    }

    [Fact]
    public void Skips_razor_expressions_and_empties()
    {
        const string markup =
            """
            <RaptorButton data-rg-modal-link="@row.LinkId">dynamic</RaptorButton>
            <RaptorButton data-rg-modal-link="">empty</RaptorButton>
            <RaptorButton data-rg-modal-link="ok">literal</RaptorButton>
            """;

        Assert.Equal(["ok"], MarkupScan.ModalLinkIds(markup));
    }

    [Fact]
    public void Finds_raptor_modal_ids_only_on_raptor_modal_elements()
    {
        const string markup =
            """
            <RaptorModal Title="Edit" Id="TestModal" Size="ModalSize.Large">
            <RaptorModal
                Id="second-modal">
            <dialog Id="not-a-raptor-modal">
            <RaptorModal Id="@dynamic">
            """;

        Assert.Equal(["TestModal", "second-modal"], MarkupScan.RaptorModalIds(markup));
    }

    [Theory]
    [InlineData("user-edit", "UserEdit")]
    [InlineData("TestModal", "TestModal")]
    [InlineData("page_group.add", "PageGroupAdd")]
    [InlineData("a", "A")]
    public void Pascal_identifier_shapes(string id, string expected) =>
        Assert.Equal(expected, MarkupScan.PascalIdentifier(id));

    [Theory]
    [InlineData("3d-view")]
    [InlineData("-")]
    [InlineData("a?b")]
    [InlineData("")]
    public void Unusable_ids_return_null(string id) =>
        Assert.Null(MarkupScan.PascalIdentifier(id));
}
