// Ported from apexcharts/Blazor-ApexCharts (https://github.com/apexcharts/Blazor-ApexCharts)
// Copyright (c) 2020 Joakim Dangården. Licensed under the MIT License.
//
// Adapted for Raptor21: namespace changed, Blazor component/JS-interop members removed. The option
// model itself is unchanged so callers can follow the upstream ApexCharts documentation directly.

#nullable disable

using System.Text.Json;
using System.Text.Json.Serialization;

using Raptor21.RCL.Charts.Models;

namespace Raptor21.RCL.Charts.Serialization;

/// <summary>
/// Ensures that JS functions are serialized with the key '@eval' so they can be appropriately evaluated on the client side
/// Example:
/// <code>
/// myFunction: {
///     "@eval": "function(value) { return value; }"
/// }
/// </code>
/// </summary>
public class FunctionStringConverter : JsonConverter<string>
{
    public override bool CanConvert(Type typeToConvert) => true;

    public override string Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        throw new NotImplementedException();
    }

    public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("@eval");
        writer.WriteStringValue(value);
        writer.WriteEndObject();
    }
}