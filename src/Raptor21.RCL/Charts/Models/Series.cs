// Ported from apexcharts/Blazor-ApexCharts (https://github.com/apexcharts/Blazor-ApexCharts)
// Copyright (c) 2020 Joakim Dangården. Licensed under the MIT License.
//
// Adapted for Raptor21: namespace changed, Blazor component/JS-interop members removed. The option
// model itself is unchanged so callers can follow the upstream ApexCharts documentation directly.

#nullable disable

namespace Raptor21.RCL.Charts.Models
{
    /// <summary> 
    /// The series is a set of data. You may have single or multiple data series. The series object can be of the following format: Single values, Paired values, Timeline Series, or Data for Pie/Donuts/RadialBars
    /// </summary>
    /// <remarks>
    /// Links:
    ///
    /// <see href="https://apexcharts.com/docs/series">JavaScript Documentation</see>,
    /// <see href="https://apexcharts.com/docs/options/series">JavaScript Reference</see>
    /// </remarks>
    public class Series
    {
        /// <summary>
        /// The group of individual data points to display on the chart.
        /// </summary>
        /// <remarks>
        /// Carried exactly as ApexCharts.js expects it: a plain array of numbers, of <c>[x, y]</c> pairs, or of
        /// <c>{ x, y }</c> objects.
        /// </remarks>
        public IEnumerable<object> Data { get; set; }

        /// <summary>
        /// The text to identify the series with
        /// </summary>
        public string Name { get; set; }

        /// <summary>
        /// Indicates if the series should be initially hidden
        /// </summary>
        public bool? Hidden { get; set; }

        /// <summary>
        /// The name of the group
        /// </summary>
        public string Group { get; set; }

        /// <summary>
        /// The internal type of this series
        /// </summary>
        public MixedType? Type { get; set; }
    }

#pragma warning disable CS1591 // Primarily for internal use
    public enum MixedType
    {
        Line,
        Area,
        Column,
        Bar,
        Scatter,
        Bubble,
        Candlestick,
        BoxPlot,
        RangeArea
    }
#pragma warning restore CS1591
}