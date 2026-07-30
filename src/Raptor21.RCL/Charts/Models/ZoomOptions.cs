// Ported from apexcharts/Blazor-ApexCharts (https://github.com/apexcharts/Blazor-ApexCharts)
// Copyright (c) 2020 Joakim Dangården. Licensed under the MIT License.
//
// Adapted for Raptor21: namespace changed, Blazor component/JS-interop members removed. The option
// model itself is unchanged so callers can follow the upstream ApexCharts documentation directly.

#nullable disable

namespace Raptor21.RCL.Charts.Models
{
    /// <summary>
    /// Class to provide options for <c>ApexChart&lt;TItem&gt;.ZoomXAsync(ZoomOptions)</c>
    /// </summary>
    public class ZoomOptions
    {
        /// <summary>
        /// The starting x-axis value. Accepts timestamp or a number
        /// </summary>
        public decimal Start { get; set; }

        /// <summary>
        /// The ending x-axis value. Accepts timestamp or a number
        /// </summary>
        public decimal End { get; set; }
    }
}
