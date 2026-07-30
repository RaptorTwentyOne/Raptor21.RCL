// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — the htmx accessor extensions.

using Microsoft.AspNetCore.Http;

namespace Raptor21.RCL.Htmx;

/// <summary>Extension entry points for the htmx request/response wrappers.</summary>
public static class HttpContextHtmxExtensions
{
    /// <summary>Whether the current request is an htmx request.</summary>
    public static bool IsHtmx(this HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return request.Headers.ContainsKey(HtmxRequestHeaderNames.HtmxRequest);
    }

    /// <summary>The (per-request cached) <see cref="HtmxRequest"/> for the current request.</summary>
    public static HtmxRequest Htmx(this HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var items = request.HttpContext.Items;
        if (items.TryGetValue(HtmxConstants.HttpContextKeys.HtmxRequestKey, out var existing) && existing is HtmxRequest cached)
            return cached;

        var htmxRequest = new HtmxRequest(request.HttpContext);
        items[HtmxConstants.HttpContextKeys.HtmxRequestKey] = htmxRequest;
        return htmxRequest;
    }

    /// <summary>A fresh <see cref="HtmxResponse"/> for the current response.</summary>
    public static HtmxResponse Htmx(this HttpResponse response)
    {
        ArgumentNullException.ThrowIfNull(response);
        return new HtmxResponse(response.HttpContext);
    }

    /// <summary>Invokes <paramref name="configure"/> with a fresh <see cref="HtmxResponse"/>.</summary>
    public static void Htmx(this HttpResponse response, Action<HtmxResponse> configure)
    {
        ArgumentNullException.ThrowIfNull(response);
        ArgumentNullException.ThrowIfNull(configure);
        configure(new HtmxResponse(response.HttpContext));
    }
}