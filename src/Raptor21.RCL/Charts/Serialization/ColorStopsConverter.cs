// Reflection-based System.Text.Json retained DELIBERATELY: every type in this serialization graph is a
// closed, library-owned model rooted by this assembly, so the practical trim exposure is the models'
// unused members, not missing types. A full JsonSerializerContext port is the tracked C.3 follow-up.
#pragma warning disable IL2026, IL2070
// Ported from apexcharts/Blazor-ApexCharts (https://github.com/apexcharts/Blazor-ApexCharts)
// Copyright (c) 2020 Joakim Dangården. Licensed under the MIT License.
//
// Adapted for Raptor21: namespace changed, Blazor component/JS-interop members removed. The option
// model itself is unchanged so callers can follow the upstream ApexCharts documentation directly.

#nullable disable

using System.Text.Json;
using System.Text.Json.Serialization;

using Raptor21.RCL.Charts.Models;

namespace Raptor21.RCL.Charts.Serialization
{
    /// <summary>
    /// Serializes <see cref="ColorStopsCollection"/> as either a flat array (shared)
    /// or a nested array (per-series) depending on how it was constructed.
    /// </summary>
    public class ColorStopsConverter : JsonConverter<ColorStopsCollection>
    {
        /// <inheritdoc/>
        /// <exception cref="NotImplementedException"/>
        public override ColorStopsCollection Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            throw new NotImplementedException();
        }

        /// <inheritdoc/>
        public override void Write(Utf8JsonWriter writer, ColorStopsCollection value, JsonSerializerOptions options)
        {
            if (value == null)
            {
                writer.WriteNullValue();
                return;
            }

            if (value.IsPerSeries)
            {
                JsonSerializer.Serialize(writer, value.PerSeriesStops, options);
            }
            else
            {
                JsonSerializer.Serialize(writer, value.PerSeriesStops[0], options);
            }
        }
    }
}
