using Microsoft.Extensions.Options;
using Raptor21.RCL.Localization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Razor.TagHelpers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Raptor21.RCL.Assets;
using Raptor21.RCL.Grid;
using Raptor21.RCL.Grid.Markup;

namespace Raptor21.RCL;

/// <summary>
/// The library's single entry point.
/// <para>
/// One call wires up the whole component library: the grid engine, the Razor Components runtime its
/// <c>&lt;RaptorGrid&gt;</c> / <c>&lt;RaptorColumn&gt;</c> components render through, the request-scoped sink
/// that render fills, the embedded client bundle's route, and the injection of its stylesheet and script
/// into every page. No middleware call, script tag or asset copy is needed on top of it.
/// </para>
/// <example>
/// <code>
/// builder.Services.AddRaptorRazorComponentLibrary();                    // one line — the whole library
/// builder.Services.AddRaptorRazorComponentLibrary(o => o.Htmx = HtmxDelivery.Never);  // host supplies htmx
/// </code>
/// </example>
/// <para>
/// The consumer must still register an <see cref="IGridAuthorization"/> and an
/// <see cref="IGridUserContext"/> — the two seams the host supplies.
/// </para>
/// </summary>
public static class Raptor21ServiceCollectionExtensions
{
    /// <summary>Registers the entire Raptor21 Razor component library in one call. See the type remarks.</summary>
    public static IServiceCollection AddRaptorRazorComponentLibrary(
        this IServiceCollection services, Action<RaptorOptions>? configure = null)
    {
        ArgumentNullException.ThrowIfNull(services);

        if (configure is not null) services.Configure(configure);
        else services.AddOptions<RaptorOptions>();

        services.AddOptions<RaptorLocalizationOptions>();

        services.AddScoped<IRaptorLocalizer>(sp => new RaptorLocalizer(
            sp.GetRequiredService<IOptions<RaptorLocalizationOptions>>().Value, sp));

        services.AddRaptorGrid();

        services.AddRazorComponents();
        services.TryAddScoped<RaptorMarkupGridSink>();

        services.TryAddScoped<Rendering.RaptorRenderGate>();

        services.TryAddSingleton<RaptorAssetStore>();
        services.AddTransient<ITagHelperComponent, RaptorAssetsTagHelperComponent>();
        services.AddTransient<IStartupFilter, RaptorAssetStartupFilter>();

        return services;
    }
}