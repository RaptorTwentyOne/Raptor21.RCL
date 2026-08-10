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

namespace Raptor21.RCL.Charts.Serialization;

/// <summary>
/// Ensures that JS function arrays are serialized with the key '@eval' so they can be appropriately evaluated on the client side
/// Example:
/// <code>
/// myFunction: {
///     "@eval": [ "function(value) { return value; }" ]
/// }
/// </code>
/// </summary>
public class FunctionValueOrListConverterConverter : JsonConverter<CustomFunction>
{
    public override bool CanConvert(Type typeToConvert) => typeToConvert == typeof(CustomFunction);

    public override CustomFunction Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        throw new NotImplementedException();
    }

    public override void Write(Utf8JsonWriter writer, CustomFunction value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("@eval");
        if (value == null || value.Count == 0)
            JsonSerializer.Serialize(writer, null, options);
        else if (value.Count == 1)
            JsonSerializer.Serialize(writer, value[0], options);
        else
            JsonSerializer.Serialize<List<string>>(writer, value, options);
        writer.WriteEndObject();
    }
}