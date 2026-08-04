namespace Raptor21.RCL.Map.Models;

/// <summary>
/// How prominently a marker is drawn.
/// <para>
/// A role, not a size: the component decides the pixels, so a set of maps across an application stays
/// visually consistent and a caller does not tune radii by hand.
/// </para>
/// </summary>
public enum MapMarkerKind
{
    /// <summary>A destination — the place connections lead to. Drawn large and filled.</summary>
    Hub,

    /// <summary>A source — where something came from. Drawn small and muted.</summary>
    Origin,

    /// <summary>Neither end of a connection; a plain point of interest.</summary>
    Point,
}

/// <summary>
/// One point on the map.
/// </summary>
public sealed class MapMarker
{
    /// <summary>
    /// Stable identity for the point, used to keep a marker across redraws. Optional; the component falls
    /// back to the coordinates when it is absent.
    /// </summary>
    public string? Id { get; set; }

    /// <summary>Latitude in degrees, -90 to 90.</summary>
    public double Lat { get; set; }

    /// <summary>Longitude in degrees, -180 to 180.</summary>
    public double Lng { get; set; }

    /// <summary>
    /// Text shown in the marker's tooltip. Plain text — the client sets it as text, never as HTML, so a
    /// label carrying markup is displayed rather than parsed.
    /// </summary>
    public string? Label { get; set; }

    /// <summary>The marker's role, which decides how prominently it is drawn.</summary>
    public MapMarkerKind Kind { get; set; } = MapMarkerKind.Point;

    /// <summary>
    /// Relative magnitude — sessions, orders, population. Scales the marker within its kind; markers are
    /// sized against the largest weight on the map, so the unit is the caller's own and never converted.
    /// Leave null for a fixed-size marker.
    /// </summary>
    public double? Weight { get; set; }

    /// <summary>CSS colour. Falls back to the kind's themed default when null.</summary>
    public string? Color { get; set; }
}
