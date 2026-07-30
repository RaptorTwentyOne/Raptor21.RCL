// Ported from apexcharts/Blazor-ApexCharts (https://github.com/apexcharts/Blazor-ApexCharts)
// Copyright (c) 2020 Joakim Dangården. Licensed under the MIT License.
//
// Adapted for Raptor21: namespace changed, Blazor component/JS-interop members removed. The option
// model itself is unchanged so callers can follow the upstream ApexCharts documentation directly.

#nullable disable

namespace Raptor21.RCL.Charts.Models
{
    /// <summary>
    /// Contains all none generic chart options
    /// </summary>
    public interface IApexChartBaseOptions
    {
        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Annotations" />
        Annotations Annotations { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Chart" />
        Chart Chart { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Color" />
        List<string> Colors { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.DataLabels" />
        DataLabels DataLabels { get; set; }

        /// <summary>
        /// Logs function calls and options to the browser console when true
        /// </summary>
        bool? Debug { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Fill" />
        Fill Fill { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.ForecastDataPoints" />
        ForecastDataPoints ForecastDataPoints { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Grid" />
        Grid Grid { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Label" />
        List<string> Labels { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Legend" />
        Legend Legend { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Markers" />
        Markers Markers { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.NoData" />
        NoData NoData { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.PlotOptions" />
        PlotOptions PlotOptions { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.States" />
        States States { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Stroke" />
        Stroke Stroke { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Subtitle" />
        Subtitle Subtitle { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Theme" />
        Theme Theme { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Title" />
        Title Title { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Tooltip" />
        Tooltip Tooltip { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.XAxis" />
        XAxis Xaxis { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.YAxis" />
        List<YAxis> Yaxis { get; set; }
    }
}