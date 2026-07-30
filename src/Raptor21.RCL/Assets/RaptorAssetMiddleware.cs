using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Raptor21.RCL.Assets;

/// <summary>
/// Serves the embedded client bundle.
/// <para>
/// The assets are a fixed, flat set of content-hashed files: nested and relative paths are rejected, no
/// content negotiation is performed, and responses are cacheable as immutable because a changed file is
/// always a different URL.
/// </para>
/// </summary>
public sealed class RaptorAssetMiddleware(RequestDelegate next, RaptorAssetStore store, IOptions<RaptorOptions> options)
{
    private readonly RaptorOptions _options = options.Value;

    public async Task InvokeAsync(HttpContext context)
    {
        var prefix = _options.RoutePrefix;

        if (!context.Request.Path.StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase, out var rest)
            || !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
        {
            await next(context);
            return;
        }

        var fileName = rest.Value?.TrimStart('/');
        if (string.IsNullOrEmpty(fileName) || fileName.Contains('/') || fileName.Contains(".."))
        {
            await next(context);
            return;
        }

        await using var stream = store.Open(fileName);
        if (stream is null)
        {
            await next(context);
            return;
        }

        var headers = context.Response.GetTypedHeaders();
        context.Response.ContentType = RaptorAssetStore.ContentType(fileName);
        headers.CacheControl = _options.ImmutableCaching
            ? new CacheControlHeaderValue { Public = true, MaxAge = TimeSpan.FromDays(365) }
            : new CacheControlHeaderValue { NoCache = true };
        if (_options.ImmutableCaching)
            context.Response.Headers.Append(HeaderNames.CacheControl, "immutable");

        if (HttpMethods.IsHead(context.Request.Method)) return;

        await stream.CopyToAsync(context.Response.Body, context.RequestAborted);
    }
}

/// <summary>
/// Inserts <see cref="RaptorAssetMiddleware"/> at the front of the pipeline, so registering the services is
/// the whole integration and no <c>Use…</c> call is required. Also verifies at startup that the assembly
/// actually carries a client bundle whenever asset injection is enabled.
/// </summary>
internal sealed class RaptorAssetStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        var options = app.ApplicationServices.GetRequiredService<IOptions<RaptorOptions>>().Value;
        if (options.InjectAssets && !app.ApplicationServices.GetRequiredService<RaptorAssetStore>().HasAssets)
        {
            throw new InvalidOperationException(
                "Raptor21: this build of Raptor21.RCL embeds no client bundle, so no stylesheet or script can " +
                "be served and the application would render completely unstyled. If you are building the " +
                "library from source, build Client/ first (npm run build, or -p:RaptorBuildClient=true). Set " +
                "RaptorOptions.InjectAssets to false only if your application supplies its own bundle.");
        }

        app.UseMiddleware<RaptorAssetMiddleware>();
        next(app);
    };
}