namespace Raptor21.RCL.Grid;

/// <summary>
/// Host seam for permission checks. The grid engine treats <c>permission</c> as an opaque token
/// (a column's Permission / a definition's ViewPermission / EditPermission) and asks the host whether
/// the current user holds it. The host implements this over its own authorization system.
/// </summary>
public interface IGridAuthorization
{
    Task<bool> HasPermissionAsync(string? userId, string permission, CancellationToken cancellationToken = default);
}
