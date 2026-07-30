// Ported from apexcharts/Blazor-ApexCharts (https://github.com/apexcharts/Blazor-ApexCharts)
// Copyright (c) 2020 Joakim Dangården. Licensed under the MIT License.
//
// Adapted for Raptor21: namespace changed, Blazor component/JS-interop members removed. The option
// model itself is unchanged so callers can follow the upstream ApexCharts documentation directly.

#nullable disable


namespace Raptor21.RCL.Charts.Models
{
    /// <summary>
    /// Interface for annotations
    /// </summary>
    public interface IAnnotation
    {
        /// <summary>
        /// Id of the annotation
        /// </summary>
        public string Id { get; set; }

        /// <inheritdoc cref="Raptor21.RCL.Charts.Models.Label" />
        public Label Label { get; set; }

    }
}
