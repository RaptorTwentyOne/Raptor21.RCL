namespace Raptor21.RCL.Map.Models;

/// <summary>
/// Everything a map draws: a basemap, some points, and the connections between them.
/// <para>
/// Deliberately a plain geometry vocabulary — coordinates, weights, labels. It carries no notion of what
/// the points mean, so the same component serves sales territories, delivery routes or site traffic, and
/// the domain mapping stays in the application that owns the domain.
/// </para>
/// </summary>
public sealed class RaptorMapModel
{
    /// <summary>The tile layer under the data.</summary>
    public MapBasemap Basemap { get; set; } = MapBasemap.CartoPositron;

    /// <summary>
    /// A tile URL template (<c>https://…/{z}/{x}/{y}.png</c>) overriding <see cref="Basemap"/>, for hosts
    /// running their own tile server. Supplying it makes <see cref="Attribution"/> the caller's
    /// responsibility.
    /// </summary>
    public string? TileUrl { get; set; }

    /// <summary>
    /// The credit line shown in the map's corner. Defaults to the one the chosen <see cref="Basemap"/>
    /// requires — tile providers require attribution, so this is not cosmetic.
    /// </summary>
    public string? Attribution { get; set; }

    /// <summary>Latitude the map opens on. Ignored while <see cref="FitToData"/> stands.</summary>
    public double? CenterLat { get; set; }

    /// <summary>Longitude the map opens on. Ignored while <see cref="FitToData"/> stands.</summary>
    public double? CenterLng { get; set; }

    /// <summary>Zoom level the map opens at. Ignored while <see cref="FitToData"/> stands.</summary>
    public int? Zoom { get; set; }

    /// <summary>
    /// Frame the view on the data instead of a fixed centre and zoom. On by default, because the data
    /// decides where the interesting part of the world is and a hardcoded centre goes wrong the moment the
    /// data moves. Turn it off to hold a fixed view across refreshes.
    /// </summary>
    public bool FitToData { get; set; } = true;

    /// <summary>Points drawn on the map.</summary>
    public IReadOnlyList<MapMarker> Markers { get; set; } = [];

    /// <summary>Connections drawn between points.</summary>
    public IReadOnlyList<MapArc> Arcs { get; set; } = [];

    /// <summary>
    /// Whether scrolling over the map zooms it.
    /// <para>
    /// Off by default: a map inside a long page is something the reader scrolls past far more often than
    /// they zoom, and capturing the wheel there traps the page scroll. The map still zooms by its
    /// buttons, by double-click, and by ctrl-scroll.
    /// </para>
    /// </summary>
    public bool ScrollWheelZoom { get; set; }

    /// <summary>Whether the zoom buttons are shown.</summary>
    public bool ZoomControl { get; set; } = true;
}
