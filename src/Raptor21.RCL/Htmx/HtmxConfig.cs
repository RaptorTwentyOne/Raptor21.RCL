// Inspired by Rizzy's HtmxConfig (https://github.com/JalexSocial/Rizzy, MIT), reduced to what Raptor21 needs.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace Raptor21.RCL.Htmx;

/// <summary>The htmx client configuration emitted into the page head as <c>&lt;meta name="htmx-config"&gt;</c>.</summary>
public sealed record HtmxConfig
{
    /// <summary>Antiforgery details the client hook uses to attach the token to htmx requests.</summary>
    public AntiforgeryConfiguration? Antiforgery { get; set; }

    /// <summary>Antiforgery cookie/field/header names and the current request token.</summary>
    public sealed class AntiforgeryConfiguration
    {
        /// <summary>Antiforgery cookie name.</summary>
        public string? CookieName { get; set; }

        /// <summary>Antiforgery form-field name.</summary>
        public string? FormFieldName { get; set; }

        /// <summary>Antiforgery request header name.</summary>
        public string? HeaderName { get; set; }

        /// <summary>The current request's antiforgery token.</summary>
        public string? RequestToken { get; set; }
    }

    /// <summary>Serializes to camelCase JSON (null members omitted) for the htmx-config meta tag —
    /// source-generated, so it stays reflection-free under trimming.</summary>
    public string Serialize() => JsonSerializer.Serialize(this, HtmxConfigJsonContext.Default.HtmxConfig);
}

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(HtmxConfig))]
internal sealed partial class HtmxConfigJsonContext : JsonSerializerContext;