// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — htmx 4 request/response header names.

namespace Raptor21.RCL.Htmx;

/// <summary>The htmx request header names (htmx 4).</summary>
public static class HtmxRequestHeaderNames
{
    /// <summary>Indicates the request is via an element using hx-boost.</summary>
    public const string Boosted = "HX-Boosted";

    /// <summary>The current URL of the browser.</summary>
    public const string CurrentUrl = "HX-Current-URL";

    /// <summary>True if the request is for history restoration after a local history-cache miss.</summary>
    public const string HistoryRestoreRequest = "HX-History-Restore-Request";

    /// <summary>Always "true" on an htmx request.</summary>
    public const string HtmxRequest = "HX-Request";

    /// <summary>The target element (htmx 4 sends "tag#id").</summary>
    public const string Target = "HX-Target";

    /// <summary>The element that triggered the request (htmx 4 sends "tag#id").</summary>
    public const string Source = "HX-Source";

    /// <summary>Whether this is a "full" or "partial" request (htmx 4).</summary>
    public const string RequestType = "HX-Request-Type";
}

/// <summary>The htmx response header names.</summary>
public static class HtmxResponseHeaderNames
{
    /// <summary>Client-side redirect without a full page reload.</summary>
    public const string Location = "HX-Location";

    /// <summary>Pushes a new url into the history stack.</summary>
    public const string PushUrl = "HX-Push-Url";

    /// <summary>Client-side redirect to a new location.</summary>
    public const string Redirect = "HX-Redirect";

    /// <summary>"true" → client does a full page refresh.</summary>
    public const string Refresh = "HX-Refresh";

    /// <summary>Replaces the current URL in the location bar.</summary>
    public const string ReplaceUrl = "HX-Replace-Url";

    /// <summary>Specifies how the response is swapped.</summary>
    public const string Reswap = "HX-Reswap";

    /// <summary>CSS selector retargeting the content update to a different element.</summary>
    public const string Retarget = "HX-Retarget";

    /// <summary>CSS selector choosing which part of the response is swapped in.</summary>
    public const string Reselect = "HX-Reselect";

    /// <summary>Triggers client-side events.</summary>
    public const string Trigger = "HX-Trigger";
}
