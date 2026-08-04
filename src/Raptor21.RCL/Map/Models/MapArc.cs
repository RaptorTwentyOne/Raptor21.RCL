namespace Raptor21.RCL.Map.Models;

/// <summary>
/// A connection between two points, drawn as a curve.
/// <para>
/// Curved rather than straight for a reason that matters once there is more than one: arcs sharing an
/// endpoint — every connection into the same hub — collapse into an unreadable star when drawn as
/// straight lines. A consistent bow separates them and gives the pair a direction to read along.
/// </para>
/// </summary>
public sealed class MapArc
{
    /// <summary>Latitude of the starting point, in degrees.</summary>
    public double FromLat { get; set; }

    /// <summary>Longitude of the starting point, in degrees.</summary>
    public double FromLng { get; set; }

    /// <summary>Latitude of the ending point, in degrees.</summary>
    public double ToLat { get; set; }

    /// <summary>Longitude of the ending point, in degrees.</summary>
    public double ToLng { get; set; }

    /// <summary>
    /// Relative magnitude of the connection. Scales the stroke against the heaviest arc on the map, so the
    /// unit is the caller's own.
    /// </summary>
    public double? Weight { get; set; }

    /// <summary>CSS colour. Falls back to the themed accent when null.</summary>
    public string? Color { get; set; }

    /// <summary>Plain-text tooltip for the connection. Set as text, never as HTML.</summary>
    public string? Label { get; set; }
}
