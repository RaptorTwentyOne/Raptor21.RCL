using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Razor.TagHelpers;
using Microsoft.Extensions.Options;

namespace Raptor21.RCL.Assets;

/// <summary>
/// Injects the stylesheet and the bundle into &lt;head&gt;.
/// <para>
/// <see cref="ITagHelperComponent"/> is the framework's seam for a library to contribute markup to every
/// page, so registering the services is the entire integration and no layout has to name a script. It also
/// keeps the content-hashed filenames on the server side, where the manifest lives; a hand-written tag
/// would have to hardcode a hash and break on every rebuild.
/// </para>
/// <para>
/// The bundle goes in &lt;head&gt;, not at the end of &lt;body&gt;. Module scripts are deferred and run
/// after parsing in document order, so a bundle at the end of the body would run after every page module
/// and the client API would not exist yet when a page module first reaches for it. From &lt;head&gt; the
/// API is installed before any page module runs; deferral still holds, so the DOM is fully parsed either
/// way.
/// </para>
/// <para>
/// The htmx URL rides along as a data attribute rather than an inline script so the page stays clean
/// under a strict CSP; the client reads it and decides whether loading is necessary.
/// </para>
/// </summary>
public sealed class RaptorAssetsTagHelperComponent(RaptorAssetStore store, IOptions<RaptorOptions> options)
    : TagHelperComponent
{
    private readonly RaptorOptions _options = options.Value;

    /// <summary>Runs after the application's own tag helper components, so this stylesheet can override theirs.</summary>
    public override int Order => 100;

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        if (!_options.InjectAssets || !store.HasAssets) return;

        if (!string.Equals(context.TagName, "head", StringComparison.OrdinalIgnoreCase)) return;

        AppendStylesheet(output);
        AppendScript(output);
    }

    private void AppendStylesheet(TagHelperOutput output)
    {
        if (Url("raptor.css") is not { } href) return;
        output.PostContent.AppendHtml($"""<link rel="stylesheet" href="{href}">""");
    }

    private void AppendScript(TagHelperOutput output)
    {
        if (Url("raptor.js") is not { } src) return;

        var htmx = _options.Htmx is HtmxDelivery.Never ? null : Url("htmx.js");
        var mode = _options.Htmx.ToString().ToLowerInvariant();
        var enc = HtmlEncoder.Default;

        var htmxAttr = htmx is null ? string.Empty : $""" data-raptor-htmx="{enc.Encode(htmx)}" """.TrimEnd();

        output.PostContent.AppendHtml(
            $"""<script type="module" src="{enc.Encode(src)}" data-raptor21 data-raptor-htmx-mode="{mode}"{htmxAttr}></script>""");
    }

    private string? Url(string logicalName) =>
        store.FileName(logicalName) is { } file ? $"{_options.RoutePrefix}/{file}" : null;
}