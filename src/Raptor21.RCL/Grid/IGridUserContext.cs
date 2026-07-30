namespace Raptor21.RCL.Grid;

/// <summary>
/// Host seam for resolving the current user id the grid passes to authorization + data providers.
/// The engine never reads request headers / claims directly — the host decides where the id comes from.
/// </summary>
public interface IGridUserContext
{
    /// <summary>Current user id as an opaque string (null if anonymous/unknown).</summary>
    string? UserId { get; }
}
