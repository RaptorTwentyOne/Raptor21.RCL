// Ported from apexcharts/Blazor-ApexCharts (https://github.com/apexcharts/Blazor-ApexCharts)
// Copyright (c) 2020 Joakim Dangården. Licensed under the MIT License.
//
// Adapted for Raptor21: namespace changed, Blazor component/JS-interop members removed. The option
// model itself is unchanged so callers can follow the upstream ApexCharts documentation directly.

#nullable disable

namespace Raptor21.RCL.Charts.Models
{
#pragma warning disable CS1591 // Enum values are self-explanatory
    /// <summary>
    /// A listing of pre-defined color themes to use with charts
    /// </summary>
    /// <remarks>
    /// Links:
    /// 
    /// <see href="https://apexcharts.github.io/Blazor-ApexCharts/chart-themes">Blazor Example</see>,
    /// <see href="https://apexcharts.com/docs/themes">JavaScript Documentation</see>,
    /// <see href="https://apexcharts.com/docs/options/theme/#palette">JavaScript Reference</see>
    /// </remarks>
    public enum PaletteType
    {
        Palette1,
        Palette2,
        Palette3,
        Palette4,
        Palette5,
        Palette6,
        Palette7,
        Palette8,
        Palette9,
        Palette10
    }
#pragma warning restore CS1591
}
