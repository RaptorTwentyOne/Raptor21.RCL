using Microsoft.Extensions.Options;
using Raptor21.RCL.Localization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Raptor21.RCL.Assets;
using Raptor21.RCL.Composition;
using Raptor21.RCL.Grid;

namespace Raptor21.RCL;

/// <summary>
/// The library's single entry point.
/// <para>
/// One call wires up the whole component library: the grid engine, the Razor Components runtime its
/// <c>&lt;RaptorGrid&gt;</c> / <c>&lt;RaptorColumn&gt;</c> components render through, the view-composition
/// pipeline behind <c>RaptorPage.Page()</c>/<c>Partial()</c>, the embedded client bundle's route, and the
/// injection of its stylesheet and script into every page. No middleware call, script tag or asset copy is
/// needed on top of it.
/// </para>
/// <example>
/// <code>
/// builder.Services.AddRaptor21();                                       // one line — the whole library
/// builder.Services.AddRaptor21(o =>
/// {
///     o.Htmx = HtmxDelivery.Never;                                      // host supplies htmx
///     o.RootComponent = typeof(HtmxApp&lt;AppShell&gt;);                      // full-page shell
///     o.DefaultLayout = typeof(MainLayout);                             // layout for pages without [Layout]
/// });
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
    public static IServiceCollection AddRaptor21(
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

        services.TryAddScoped<Rendering.RaptorRenderGate>();

        services.TryAddSingleton<RaptorAssetStore>();
        services.AddTransient<IStartupFilter, RaptorAssetStartupFilter>();

        // The view-composition pipeline: RaptorPage.Page()/Partial() and the OOB swap outlet resolve these
        // on every render.
        services.AddHttpContextAccessor();
        services.AddScoped<IRaptorViewService, RaptorViewService>();
        services.AddScoped<IHtmxSwapService, HtmxSwapService>();

        // RaptorOptions carries the composition settings; RaptorView keeps reading IOptions<RaptorConfig>,
        // so bridge them here. RaptorConfig's setters validate (RootComponent must be HtmxApp<T>), which is
        // why the values are assigned through the property rather than copied field-for-field.
        services.AddOptions<RaptorConfig>().Configure<IOptions<RaptorOptions>>((config, options) =>
        {
            if (options.Value.RootComponent is not null) config.RootComponent = options.Value.RootComponent;
            if (options.Value.DefaultLayout is not null) config.DefaultLayout = options.Value.DefaultLayout;
        });

        return services;
    }
}
