// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — htmx 4 request wrapper.

using Microsoft.AspNetCore.Http;

namespace Raptor21.RCL.Htmx;

/// <summary>Strongly-typed read access to the htmx request headers for the current request.</summary>
public sealed class HtmxRequest
{
    /// <summary>The HTTP method.</summary>
    public string Method { get; }

    /// <summary>The request path.</summary>
    public PathString Path { get; }

    /// <summary>Whether this is an htmx-triggered request (HX-Request header present).</summary>
    public bool IsHtmx { get; }

    /// <summary>Whether the request was initiated by an element using hx-boost.</summary>
    public bool IsBoosted { get; }

    /// <summary>Whether this is an htmx history-restore request.</summary>
    public bool IsHistoryRestore { get; }

    /// <summary>The current browser URL (HX-Current-URL).</summary>
    public Uri? CurrentUrl { get; }

    /// <summary>The target element (htmx 4 "tag#id"), or null.</summary>
    public string? Target { get; }

    /// <summary>The triggering element (htmx 4 "tag#id"), or null.</summary>
    public string? Source { get; }

    /// <summary>The id parsed out of the htmx 4 "tag#id" <see cref="Target"/>.</summary>
    public string? TargetId => Target?.Split('#').LastOrDefault();

    /// <summary>The id parsed out of the htmx 4 "tag#id" <see cref="Source"/>.</summary>
    public string? SourceId => Source?.Split('#').LastOrDefault();

    /// <summary>The htmx request type ("full" or "partial"), or null.</summary>
    public string? RequestType { get; }

    /// <summary>Creates a wrapper over the current request's htmx headers.</summary>
    public HtmxRequest(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        var headers = context.Request.Headers;

        Method = context.Request.Method;
        Path = context.Request.Path;
        IsHtmx = headers.ContainsKey(HtmxRequestHeaderNames.HtmxRequest);
        IsBoosted = headers.ContainsKey(HtmxRequestHeaderNames.Boosted);
        IsHistoryRestore = headers.ContainsKey(HtmxRequestHeaderNames.HistoryRestoreRequest);
        CurrentUrl = ReadHeader(headers, HtmxRequestHeaderNames.CurrentUrl,
            static value => Uri.TryCreate(value, UriKind.RelativeOrAbsolute, out var uri) ? uri : null);
        Target = ReadHeader(headers, HtmxRequestHeaderNames.Target);
        Source = ReadHeader(headers, HtmxRequestHeaderNames.Source);
        RequestType = ReadHeader(headers, HtmxRequestHeaderNames.RequestType);
    }

    private static string? ReadHeader(IHeaderDictionary headers, string key) =>
        headers.TryGetValue(key, out var values) && values.Count > 0 &&
        values[0] is { } value && !string.IsNullOrWhiteSpace(value)
            ? value.Trim()
            : null;

    private static T? ReadHeader<T>(IHeaderDictionary headers, string key, Func<string, T?> factory) =>
        ReadHeader(headers, key) is { } value ? factory(value) : default;
}
