namespace Raptor21.RCL.Map.Models;

/// <summary>
/// The tile layer painted under the data.
/// <para>
/// Named rather than free-form URLs: a tile template is a network dependency and an attribution
/// obligation, so the set is curated here and the client holds the matching URL and credit line. A host
/// that needs its own tile server supplies <see cref="RaptorMapModel.TileUrl"/> instead.
/// </para>
/// </summary>
public enum MapBasemap
{
    /// <summary>Muted light grey. Data reads first; the basemap stays background. The default.</summary>
    CartoPositron,

    /// <summary>The dark counterpart of <see cref="CartoPositron"/>, for dark-themed pages.</summary>
    CartoDarkMatter,

    /// <summary>Standard OpenStreetMap cartography — full colour, road and landuse detail.</summary>
    OpenStreetMap,
}
