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
/// Converter for lists of strings that detects entries containing a JavaScript function definition
/// (case-insensitive search for the word "function") and serializes those as an object with the "@eval" key
/// so that ApexCharts interprets them as executable functions instead of plain strings.
///
/// Output behavior:
/// - Normal strings are written as JSON string elements inside the array.
/// - Strings representing functions are written as:
///   { "@eval": "function(x) { return x; }" }
///
/// Example:
/// C# input:
/// <code>
/// new List&lt;string&gt;
/// {
///     "Label 1",
///     "function(w) { return w; }",
///     "Another label"
/// };
/// </code>
///
/// JSON output:
/// <code>
/// [
///   "Label 1",
///   { "@eval": "function(w) { return w; }" },
///   "Another label"
/// ]
/// </code>
///
/// Note: Deserialization (Read) is not implemented because this converter is intended only for outgoing
/// serialization to the client.
/// </summary>
public class ListStringOrFunctionConverter : JsonConverter<List<string>>
{
    public override bool CanConvert(Type typeToConvert) => typeToConvert == typeof(List<string>);

    public override List<string> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        throw new NotImplementedException();
    }

    public override void Write(Utf8JsonWriter writer, List<string> value, JsonSerializerOptions options)
    {
        writer.WriteStartArray();

        foreach (var item in value)
        {
            if (ChartUtilities.IsJavaScriptFunction(item))
            {
                writer.WriteStartObject();
                writer.WritePropertyName("@eval");
                JsonSerializer.Serialize(writer, item, options);
                writer.WriteEndObject();
            }
            else
            {
                writer.WriteStringValue(item);
            }
        }

        writer.WriteEndArray();
    }
}