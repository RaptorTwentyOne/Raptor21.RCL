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
    /// Facilitates serialization of <see cref="ValueOrList{T}"/>
    /// </summary>
    /// <typeparam name="T"></typeparam>
    public class ValueOrListConverter<T> : JsonConverter<ValueOrList<T>>
    {
        /// <inheritdoc/>
        /// <exception cref="NotImplementedException"></exception>
        public override ValueOrList<T> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            throw new NotImplementedException();
        }

        /// <inheritdoc/>
        public override bool CanConvert(Type typeToConvert) => typeof(ValueOrList<T>).IsAssignableFrom(typeToConvert);

        /// <inheritdoc/>
        public override void Write(Utf8JsonWriter writer, ValueOrList<T> value, JsonSerializerOptions options)
        {
            if (value == null || value.Count == 0)
                JsonSerializer.Serialize(writer, null, options);
            else if (value.Count == 1)
                JsonSerializer.Serialize(writer, value[0], options);
            else
                JsonSerializer.Serialize<List<T>>(writer, value, options);
        }
    }
}
