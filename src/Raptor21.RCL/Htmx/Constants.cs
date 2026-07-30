// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — trimmed to what Raptor21 uses.

namespace Raptor21.RCL.Htmx;

/// <summary>String constants for the htmx integration (htmx 4).</summary>
internal static class HtmxConstants
{
    /// <summary>Antiforgery cookie name used by the client hook.</summary>
    public const string AntiforgeryCookieName = "HX-XSRF-TOKEN";

    internal static class Nonce
    {
        /// <summary>Response header carrying the per-request CSP nonce.</summary>
        public const string NonceResponseHeader = "HX-Nonce";
    }

    internal static class HttpContextKeys
    {
        public const string HtmxRequestKey = "Raptor21.Htmx:Request";
        public const string FormFieldMappingsKey = "Raptor21.Htmx:FieldMappings";
    }

    internal static class Elements
    {
        /// <summary>htmx 4 explicit tag for out-of-band swaps.</summary>
        public const string HxPartial = "hx-partial";
    }
}