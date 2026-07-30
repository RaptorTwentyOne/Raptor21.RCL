// Ported from apexcharts/Blazor-ApexCharts (https://github.com/apexcharts/Blazor-ApexCharts)
// Copyright (c) 2020 Joakim Dangården. Licensed under the MIT License.
//
// Adapted for Raptor21: namespace changed, Blazor component/JS-interop members removed. The option
// model itself is unchanged so callers can follow the upstream ApexCharts documentation directly.

#nullable disable


namespace Raptor21.RCL.Charts.Models
{
    /// <remarks>
    /// Accepts either a single value or collection of values. Providing a collection of values in a multi-series chart will assign sizes where each index corresponds to the series index.<br /><br />
    /// 
    /// Example:<br /><br />
    /// 
    /// <code>
    /// // Create options
    /// var options = new ApexChartOptions&lt;object&gt;() 
    /// {
    ///     Markers = new Markers()
    /// };
    /// 
    /// // Single size
    /// var size = 5d;
    /// options.Markers.Size = size;
    /// 
    /// // Multiple sizes
    /// var sizes = new List&lt;int&gt; { 5, 6, 7 };
    /// options.Markers.Size = sizes;
    /// </code>
    /// </remarks>
    public class Size : ValueOrList<double>
    {
        /// <summary>
        /// Converts a size collection into a list of doubles
        /// </summary>
        public static implicit operator List<double>(Size source) => source.values;

        /// <summary>
        /// Converts a list of doubles into a size collection
        /// </summary>
        public static implicit operator Size(List<double> source) => new(source);

        /// <summary>
        /// Converts a list of ints into a size collection
        /// </summary>
        public static implicit operator Size(List<int> source) 
        {
            if (source == null)
                return new Size();
            else
                return new Size(source.Select(Convert.ToDouble));
        }

        /// <summary>
        /// Converts a double into a size collection
        /// </summary>
        public static implicit operator Size(double source) => new(source);

        /// <summary>
        /// Creates a new collection of sizes with the provided values
        /// </summary>
        public Size(params double[] values) : base(values) { }

        /// <summary>
        /// Creates a new collection of sizes with the provided values
        /// </summary>
        public Size(IEnumerable<double> values) : base(values) { }
    }
}
