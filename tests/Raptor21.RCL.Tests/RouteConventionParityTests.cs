using Xunit;

namespace Raptor21.RCL.Tests;

/// <summary>
/// The convention route rule lives twice — <see cref="Pages.RaptorRouteConvention"/> (runtime scanner) and
/// <see cref="SourceGenerators.RouteConvention"/> (analyzer; netstandard2.0 cannot reference the net10.0
/// library). These tests are the parity contract from RFC 0001 Part 1: if the two implementations ever
/// disagree, a component's generated URL and its actual endpoint silently split — the exact drift the whole
/// typed-routes design exists to prevent — so the corpus below leans into the awkward shapes (acronyms,
/// digits, single letters), not just the happy path.
/// </summary>
public sealed class RouteConventionParityTests
{
    public static TheoryData<string> Corpus =>
    [
        "PageGroupModal",
        "CustomerQuickPanel",
        "EPCModal",
        "EpcDetailPage",
        "Vkorg21Panel",
        "A",
        "AB",
        "ABc",
        "AbC",
        "UploadWizard360",
        "X509CertificateViewer",
        "HTMLRenderer",
        "lowercase",
    ];

    [Theory]
    [MemberData(nameof(Corpus))]
    public void Generator_and_runtime_agree(string typeName) =>
        Assert.Equal(
            Pages.RaptorRouteConvention.RouteFor(typeName),
            SourceGenerators.RouteConvention.RouteFor(typeName));

    [Theory]
    [InlineData("PageGroupModal", "page-group-modal")]
    [InlineData("EPCModal", "epc-modal")]
    [InlineData("Vkorg21Panel", "vkorg21-panel")]
    [InlineData("HTMLRenderer", "html-renderer")]
    [InlineData("UploadWizard360", "upload-wizard360")]
    [InlineData("A", "a")]
    [InlineData("lowercase", "lowercase")]
    public void Kebab_shape(string typeName, string expected) =>
        Assert.Equal(expected, Pages.RaptorRouteConvention.Kebab(typeName));

    [Fact]
    public void Route_carries_the_components_prefix() =>
        Assert.Equal("/components/page-group-modal", Pages.RaptorRouteConvention.RouteFor("PageGroupModal"));
}
