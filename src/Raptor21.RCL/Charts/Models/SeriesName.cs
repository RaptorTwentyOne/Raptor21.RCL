// Ported from apexcharts/Blazor-ApexCharts (https://github.com/apexcharts/Blazor-ApexCharts)
// Copyright (c) 2020 Joakim Dangården. Licensed under the MIT License.
//
// Adapted for Raptor21: namespace changed, Blazor component/JS-interop members removed. The option
// model itself is unchanged so callers can follow the upstream ApexCharts documentation directly.

#nullable disable


namespace Raptor21.RCL.Charts.Models
{
    /// <remarks>
    /// Accepts either a single value or collection of values. 
    /// </remarks>
      public class SeriesName : ValueOrList<string>
    {
        /// <summary>
        /// Converts a text collection into a list of strings
        /// </summary>
        public static implicit operator List<string>(SeriesName source) => source.values;

        /// <summary>
        /// Converts a list of strings into a text collection
        /// </summary>
        public static implicit operator SeriesName(List<string> source) => new(source);

        /// <summary>
        /// Converts a string into a text collection
        /// </summary>
        public static implicit operator SeriesName(string source) => new(source);

        /// <summary>
        /// Creates a new collection of texts with the provided values
        /// </summary>
        public SeriesName(params string[] values) : base(values) { }

        /// <summary>
        /// Creates a new collection of texts with the provided values
        /// </summary>
        public SeriesName(IEnumerable<string> values) : base(values) { }
    }
}
