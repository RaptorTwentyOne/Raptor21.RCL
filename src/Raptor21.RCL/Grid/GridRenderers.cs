using System.Globalization;

namespace Raptor21.RCL.Grid;

/// <summary>
/// Reusable cell renderers. They take the already-typed value rather than an untyped context, so a
/// column wires one up with a lambda that the compiler checks:
/// <c>GridColumn&lt;UserDto&gt;.For(u =&gt; u.IsActive, "Active") with { Cell = u =&gt; GridRenderers.Boolean(u.IsActive) }</c>.
/// Screens with their own rendering just supply their own methods instead.
/// </summary>
public static class GridRenderers
{
    /// <summary>Green check / red cross.</summary>
    public static GridCell Boolean(bool value) => GridCell.Raw(value
        ? "<span class=\"rg-ico rg-ico-check rg-ok\"></span>"
        : "<span class=\"rg-ico rg-ico-close rg-bad\"></span>");

    /// <summary>Date-only, current culture. Null renders empty.</summary>
    public static GridCell Date(DateTime? value) =>
        value is { } d ? GridCell.Text(d.ToString("d", CultureInfo.CurrentCulture)) : GridCell.Empty;

    /// <summary>Date + time, current culture. Null renders empty.</summary>
    public static GridCell DateTime(DateTime? value) =>
        value is { } d ? GridCell.Text(d.ToString("g", CultureInfo.CurrentCulture)) : GridCell.Empty;

    /// <summary>Date + time from an offset, rendered in local time.</summary>
    public static GridCell DateTime(DateTimeOffset? value) =>
        value is { } d ? DateTime(d.LocalDateTime) : GridCell.Empty;
}
