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
/// Serializes a <see cref="ContextMenuItem"/> as either a bare built-in string (e.g. <c>"annotate"</c>) when only
/// <see cref="ContextMenuItem.Name"/> is set, or as a custom item object <c>{ id, label, icon, onClick }</c> otherwise.
/// A custom item's <c>onClick</c> is emitted as a JS function via the <c>@eval</c> convention (see
/// <see cref="FunctionStringConverter"/>).
/// </summary>
public class ContextMenuItemConverter : JsonConverter<ContextMenuItem>
{
    public override ContextMenuItem Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => throw new NotImplementedException();

    public override void Write(Utf8JsonWriter writer, ContextMenuItem value, JsonSerializerOptions options)
    {
        if (value == null) { writer.WriteNullValue(); return; }

        var hasCustom = value.Id != null || value.Label != null || value.Icon != null || value.OnClick != null;

        if (!hasCustom && value.Name != null)
        {
            writer.WriteStringValue(value.Name);
            return;
        }

        writer.WriteStartObject();
        if (value.Id != null) { writer.WriteString("id", value.Id); }
        if (value.Label != null) { writer.WriteString("label", value.Label); }
        if (value.Icon != null) { writer.WriteString("icon", value.Icon); }
        if (value.OnClick != null)
        {
            writer.WritePropertyName("onClick");
            writer.WriteStartObject();
            writer.WritePropertyName("@eval");
            writer.WriteStringValue(value.OnClick);
            writer.WriteEndObject();
        }
        writer.WriteEndObject();
    }
}
