using Microsoft.Extensions.DependencyInjection;
using Raptor21.RCL.Composition;

namespace Raptor21.RCL.Mvc;

/// <summary>DI wiring for the Raptor MVC view composition (controllers rendering Razor components).</summary>
public static class RaptorMvcExtensions
{
    /// <summary>
    /// Registers the view-rendering service and the composition config. Call after <c>AddControllers</c> and
    /// <c>AddRazorComponents</c>. Configure the root component / default layout via <paramref name="configure"/>.
    /// </summary>
    public static IServiceCollection AddRaptorMvc(this IServiceCollection services, Action<RaptorConfig>? configure = null)
    {
        services.AddHttpContextAccessor();
        services.AddScoped<IRaptorViewService, RaptorViewService>();
        services.AddScoped<IHtmxSwapService, HtmxSwapService>();
        if (configure is not null)
            services.Configure(configure);
        return services;
    }
}