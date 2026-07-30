// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — htmx response wrapper.

using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.DependencyInjection;

namespace Raptor21.RCL.Htmx;

/// <summary>Fluent helper for setting htmx response headers on the current response.</summary>
public sealed class HtmxResponse(HttpContext context)
{
    private const string EmptyBodyKey = "Raptor21.Htmx:EmptyResponseBody";
    private const string TriggerItemsKey = "Raptor21.Htmx:TriggerSet";

    private readonly IHeaderDictionary _headers = context.Response.Headers;
    private readonly bool _isHtmxRequest = context.Request.Headers.ContainsKey(HtmxRequestHeaderNames.HtmxRequest);

    /// <summary>Whether an empty response body was requested (e.g. via <see cref="EmptyBody"/> / redirect).</summary>
    public bool EmptyResponseBodyRequested
    {
        get => context.Items.TryGetValue(EmptyBodyKey, out var value) && value is true;
        private set => context.Items[EmptyBodyKey] = value;
    }

    /// <summary>Sets the response status code.</summary>
    public HtmxResponse StatusCode(HttpStatusCode statusCode)
    {
        AssertIsHtmxRequest();
        context.Response.StatusCode = (int)statusCode;
        return this;
    }

    /// <summary>Render no body even if the component would have produced markup (headers/cookies still sent).</summary>
    public HtmxResponse EmptyBody()
    {
        AssertIsHtmxRequest();
        EmptyResponseBodyRequested = true;
        return this;
    }

    /// <summary>Client-side redirect without a full page reload.</summary>
    public HtmxResponse Location(string path)
    {
        AssertIsHtmxRequest();
        _headers[HtmxResponseHeaderNames.Location] = path;
        return this;
    }

    /// <summary>Pushes a new url onto the history stack.</summary>
    public HtmxResponse PushUrl(string url)
    {
        AssertIsHtmxRequest();
        _headers[HtmxResponseHeaderNames.PushUrl] = url;
        return this;
    }

    /// <summary>Pushes a new url onto the history stack.</summary>
    public HtmxResponse PushUrl(Uri url)
    {
        ArgumentNullException.ThrowIfNull(url);
        return PushUrl(url.ToString());
    }

    /// <summary>Prevents the browser history from being updated.</summary>
    public HtmxResponse PreventBrowserHistoryUpdate()
    {
        AssertIsHtmxRequest();
        _headers[HtmxResponseHeaderNames.PushUrl] = "false";
        return this;
    }

    /// <summary>Prevents the browser's current url from being updated.</summary>
    public HtmxResponse PreventBrowserCurrentUrlUpdate()
    {
        AssertIsHtmxRequest();
        _headers[HtmxResponseHeaderNames.ReplaceUrl] = "false";
        return this;
    }

    /// <summary>Client-side redirect to a new location.</summary>
    public HtmxResponse Redirect(string url)
    {
        AssertIsHtmxRequest();
        _headers[HtmxResponseHeaderNames.Redirect] = url;
        EmptyResponseBodyRequested = true;
        return this;
    }

    /// <summary>Client-side redirect to a new location.</summary>
    public HtmxResponse Redirect(Uri url)
    {
        ArgumentNullException.ThrowIfNull(url);
        return Redirect(url.ToString());
    }

    /// <summary>Full client-side page refresh.</summary>
    public HtmxResponse Refresh()
    {
        AssertIsHtmxRequest();
        _headers[HtmxResponseHeaderNames.Refresh] = "true";
        EmptyResponseBodyRequested = true;
        return this;
    }

    /// <summary>Replaces the current URL in the location bar.</summary>
    public HtmxResponse ReplaceUrl(string url)
    {
        AssertIsHtmxRequest();
        _headers[HtmxResponseHeaderNames.ReplaceUrl] = url;
        return this;
    }

    /// <summary>Replaces the current URL in the location bar.</summary>
    public HtmxResponse ReplaceUrl(Uri url)
    {
        ArgumentNullException.ThrowIfNull(url);
        return ReplaceUrl(url.ToString());
    }

    /// <summary>Specifies how the response is swapped, as a raw htmx swap modifier string.</summary>
    public HtmxResponse Reswap(string modifier)
    {
        AssertIsHtmxRequest();
        ArgumentException.ThrowIfNullOrWhiteSpace(modifier);
        _headers[HtmxResponseHeaderNames.Reswap] = modifier;
        return this;
    }

    /// <summary>Specifies how the response is swapped.</summary>
    public HtmxResponse Reswap(SwapStyle swapStyle, string? modifier = null)
    {
        AssertIsHtmxRequest();

        if (swapStyle is SwapStyle.Default)
        {
            if (!string.IsNullOrWhiteSpace(modifier))
                _headers[HtmxResponseHeaderNames.Reswap] = modifier;
            return this;
        }

        var style = swapStyle.ToHtmxString();
        _headers[HtmxResponseHeaderNames.Reswap] =
            string.IsNullOrWhiteSpace(modifier) ? style : $"{style} {modifier}";
        return this;
    }

    /// <summary>Retargets the content update to a different element (CSS selector).</summary>
    public HtmxResponse Retarget(string selector)
    {
        AssertIsHtmxRequest();
        _headers[HtmxResponseHeaderNames.Retarget] = selector;
        return this;
    }

    /// <summary>Chooses which part of the response is swapped in (CSS selector).</summary>
    public HtmxResponse Reselect(string selector)
    {
        AssertIsHtmxRequest();
        _headers[HtmxResponseHeaderNames.Reselect] = selector;
        return this;
    }

    /// <summary>Triggers a client-side event (no detail).</summary>
    public HtmxResponse Trigger(string eventName)
    {
        AssertIsHtmxRequest();
        MergeTrigger(eventName, (object?)null, null);
        return this;
    }

    /// <summary>Triggers a client-side event carrying a JSON detail payload.</summary>
    public HtmxResponse Trigger<TEventDetail>(string eventName, TEventDetail detail, JsonSerializerOptions? jsonSerializerOptions = null)
    {
        AssertIsHtmxRequest();
        MergeTrigger(eventName, detail, jsonSerializerOptions);
        return this;
    }

    private void MergeTrigger<TEventDetail>(string eventName, TEventDetail? detail, JsonSerializerOptions? jsonSerializerOptions)
    {
        jsonSerializerOptions ??= context.RequestServices.GetService<JsonOptions>()?.SerializerOptions;

        var set = context.Items.TryGetValue(TriggerItemsKey, out var current) && current is List<TriggerEvent> existing
            ? existing
            : [];

        if (!set.Exists(e => e.Name.Equals(eventName, StringComparison.OrdinalIgnoreCase)))
        {
            var detailJson = detail is not null ? JsonSerializer.Serialize(detail, jsonSerializerOptions) : null;
            set.Add(new TriggerEvent(eventName, detailJson));
        }

        context.Items[TriggerItemsKey] = set;

        _headers[HtmxResponseHeaderNames.Trigger] = set.TrueForAll(e => e.Detail is null)
            ? string.Join(',', set.Select(e => e.Name))
            : $"{{{string.Join(',', set)}}}";
    }

    private readonly record struct TriggerEvent(string Name, string? Detail)
    {
        public override string ToString() =>
            Detail is null
                ? $"\"{JsonEncodedText.Encode(Name)}\":null"
                : $"\"{JsonEncodedText.Encode(Name)}\":{Detail}";
    }

    private void AssertIsHtmxRequest()
    {
        if (!_isHtmxRequest)
            throw new InvalidOperationException(
                "The active request is not an htmx request; setting htmx response headers has no effect.");
    }
}