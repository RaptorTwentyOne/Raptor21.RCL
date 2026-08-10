// Reflection-based System.Text.Json retained DELIBERATELY: every type in this serialization graph is a
// closed, library-owned model rooted by this assembly, so the practical trim exposure is the models'
// unused members, not missing types. A full JsonSerializerContext port is the tracked C.3 follow-up.
#pragma warning disable IL2026, IL2070
using System.Text.Json;
using System.Text.Json.Serialization;
using Raptor21.RCL.Map.Models;

namespace Raptor21.RCL.Map;

/// <summary>
/// Turns a server-authored map into the JSON its client half reads.
/// </summary>
public static class RaptorMapData
{
    /// <summary>
    /// The serialisation contract between the component and its client half.
    /// <list type="bullet">
    /// <item><b>camelCase</b> keys and enum values, matching the names the client reads.</item>
    /// <item>
    /// <b>Nulls omitted</b>, so an absent colour or weight stays absent and the client applies its own
    /// default rather than receiving an explicit null to guard against.
    /// </item>
    /// <item>
    /// <b>The default encoder</b>, not <c>UnsafeRelaxedJsonEscaping</c>. It escapes <c>&lt;</c>,
    /// <c>&gt;</c> and <c>&amp;</c>, so a place name containing <c>&lt;/script&gt;</c> cannot close the
    /// element this JSON is written into — the component emits it through a <c>MarkupString</c>, which
    /// bypasses Blazor's own encoding. <c>JSON.parse</c> decodes the escapes on the client, so the text
    /// arrives unchanged either way.
    /// </item>
    /// </list>
    /// <para>
    /// Unlike the chart's payload this carries data only — no function markers, nothing evaluated on the
    /// client — so a page with a map needs no <c>unsafe-eval</c> in its Content-Security-Policy.
    /// </para>
    /// </summary>
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    /// <summary>Serialises a map for the client.</summary>
    public static string Serialize(RaptorMapModel model) => JsonSerializer.Serialize(model, SerializerOptions);
}
