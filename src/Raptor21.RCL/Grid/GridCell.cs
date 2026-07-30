using System.Net;

namespace Raptor21.RCL.Grid;

/// <summary>
/// A rendered grid cell. The .NET grid engine produces one of these per column per row; the
/// <c>_RaptorGrid</c> partial writes <see cref="Html"/> raw. Html is expected to be already safe
/// (either HtmlEncoded plain text via <see cref="Text"/>, or renderer-authored trusted markup).
/// </summary>
public sealed record GridCell(string Html, string? CssClass = null, string? Tooltip = null)
{
    public static readonly GridCell Empty = new(string.Empty);

    /// <summary>Plain text, HTML-encoded — the safe default for untrusted values.</summary>
    public static GridCell Text(string? value, string? cssClass = null) =>
        new(WebUtility.HtmlEncode(value ?? string.Empty), cssClass);

    /// <summary>Trusted markup authored by a renderer. Caller is responsible for encoding any
    /// interpolated user data.</summary>
    public static GridCell Raw(string html, string? cssClass = null, string? tooltip = null) =>
        new(html, cssClass, tooltip);
}
