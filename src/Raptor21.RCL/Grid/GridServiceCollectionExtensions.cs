using Microsoft.Extensions.DependencyInjection;

namespace Raptor21.RCL.Grid;

/// <summary>
/// Registers the grid engine's two services. That is the whole setup.
/// <para>
/// There is no assembly scanning and no grid registry: a grid is owned by the page that declares it
/// (<see cref="IGridSource{TRow}"/>), and that page is activated by the Razor Pages framework, so nothing
/// is discovered by reflection or resolved by id. There is also no controller and no route — the page
/// exposes its own handlers via <see cref="RaptorGridPageExtensions"/>, so this library contributes no
/// endpoints to the consuming application.
/// </para>
/// <para>
/// The consumer must also register an <see cref="IGridAuthorization"/> and an
/// <see cref="IGridUserContext"/> implementation — the two host seams.
/// </para>
/// </summary>
public static class GridServiceCollectionExtensions
{
    public static IServiceCollection AddRaptorGrid(this IServiceCollection services)
    {
        services.AddSingleton<GridRequestBinder>();
        services.AddScoped<RaptorGridBuilder>();
        return services;
    }
}
