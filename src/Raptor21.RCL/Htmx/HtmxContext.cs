// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT).

using Microsoft.AspNetCore.Http;

namespace Raptor21.RCL.Htmx;

/// <summary>Access to the htmx request and response for the current <see cref="HttpContext"/>.</summary>
public sealed class HtmxContext
{
    /// <summary>Creates a context over the current request/response.</summary>
    public HtmxContext(HttpContext context)
    {
        Request = new HtmxRequest(context);
        Response = new HtmxResponse(context);
    }

    /// <summary>The htmx request headers.</summary>
    public HtmxRequest Request { get; }

    /// <summary>Fluent access to the htmx response headers.</summary>
    public HtmxResponse Response { get; }
}