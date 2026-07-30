// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — HtmxConfigHeadOutlet.

using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Raptor21.RCL.Htmx;

namespace Raptor21.RCL.Composition;

/// <summary>
/// Renders the <c>&lt;meta name="htmx-config"&gt;</c> tag carrying the (per-request) htmx configuration,
/// including the antiforgery token the client hook attaches to htmx requests. SSR-only — it reads the cascaded
/// <see cref="HttpContext"/> and calls <see cref="IAntiforgery.GetAndStoreTokens"/>.
/// </summary>
public sealed class HtmxConfigHeadOutlet : ComponentBase
{
    private string _json = string.Empty;

    [Inject] private IOptions<HtmxConfig> Options { get; set; } = default!;
    [Inject] private IAntiforgery Antiforgery { get; set; } = default!;
    [Inject] private IOptions<AntiforgeryOptions> AntiforgeryOptions { get; set; } = default!;

    [CascadingParameter] private HttpContext? HttpContext { get; set; }

    /// <inheritdoc/>
    protected override void BuildRenderTree(RenderTreeBuilder builder) =>
        builder.AddMarkupContent(0, $"<meta name=\"htmx-config\" content='{_json}'>");

    /// <inheritdoc/>
    protected override void OnParametersSet()
    {
        var config = Options.Value;

        if (HttpContext is not null)
        {
            var options = AntiforgeryOptions.Value;
            var tokens = Antiforgery.GetAndStoreTokens(HttpContext);
            // ReSharper disable once WithExpressionModifiesAllMembers
            config = config with
            {
                Antiforgery = new HtmxConfig.AntiforgeryConfiguration
                {
                    CookieName = options.Cookie.Name,
                    FormFieldName = options.FormFieldName,
                    HeaderName = options.HeaderName,
                    RequestToken = tokens.RequestToken,
                },
            };
        }

        _json = config.Serialize();
    }
}