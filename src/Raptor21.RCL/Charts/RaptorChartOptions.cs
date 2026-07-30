using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Raptor21.RCL.Charts.Models;
using Raptor21.RCL.Charts.Serialization;

namespace Raptor21.RCL.Charts;

/// <summary>
/// Turns a server-authored chart into the JSON its client half reads.
/// </summary>
public static class RaptorChartOptions
{
    /// <summary>
    /// The serialisation contract between the component and its client half.
    /// <list type="bullet">
    /// <item>
    /// <b>camelCase</b>, matching the charting library's option names. The library ignores keys it does not
    /// recognise rather than reporting them, so a mismatch draws the chart with defaults instead of failing.
    /// </item>
    /// <item>
    /// <b>Nulls omitted</b>. To the library an explicit null is not the same as an absent key: it overrides
    /// the default instead of leaving it alone.
    /// </item>
    /// <item>
    /// <b>The default encoder</b>, not <c>UnsafeRelaxedJsonEscaping</c>. It escapes <c>&lt;</c>,
    /// <c>&gt;</c> and <c>&amp;</c>, so a series name or axis label containing <c>&lt;/script&gt;</c>
    /// cannot close the element this JSON is written into — the component emits it through a
    /// <c>MarkupString</c>, which bypasses Blazor's own encoding. <c>JSON.parse</c> decodes the escapes on
    /// the client, so the text arrives unchanged either way.
    /// </item>
    /// </list>
    /// </summary>
    private static readonly JsonSerializerOptions SerializerOptions = CreateOptions();

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };

        options.Converters.Add(new CustomJsonStringEnumConverter());
        options.Converters.Add(new ValueOrListConverter<string>());
        options.Converters.Add(new ValueOrListConverter<double>());
        options.Converters.Add(new ValueOrListConverter<Curve>());
        options.Converters.Add(new ValueOrListConverter<FillPatternStyle>());
        options.Converters.Add(new ValueOrListConverter<FillType>());
        options.Converters.Add(new ColorStopsConverter());

        return options;
    }

    /// <summary>
    /// Chart types whose <c>series</c> is a flat list of numbers rather than a list of series objects.
    /// </summary>
    private static readonly HashSet<ChartType> FlatSeriesTypes =
    [
        ChartType.Pie, ChartType.Donut, ChartType.PolarArea, ChartType.RadialBar
    ];

    /// <summary>Serialises a chart's options for the client.</summary>
    public static string Serialize(ApexChartOptions options)
    {
        var json = JsonSerializer.SerializeToNode(options, SerializerOptions)!;
        FlattenSeriesIfNeeded(options, json);
        return json.ToJsonString(SerializerOptions);
    }

    /// <summary>
    /// Rewrites <c>series</c> to a flat number array for the chart types that require it.
    /// <para>
    /// The model carries every chart's series the same way — a list of series objects, each with its own
    /// data — which is what the axis charts take. The circular ones do not: a pie or a donut expects
    /// <c>series: [44, 55, 13]</c>, one number per slice, with the names supplied separately in
    /// <c>labels</c>. Given the nested shape the library still draws, but its totals come out as NaN.
    /// </para>
    /// <para>
    /// Only the first series is used, matching the library: these charts have no concept of a second one.
    /// </para>
    /// </summary>
    private static void FlattenSeriesIfNeeded(ApexChartOptions options, JsonNode json)
    {
        if (options.Chart?.Type is not { } type || !FlatSeriesTypes.Contains(type)) return;

        if (json["series"] is not JsonArray series || series.Count == 0) return;
        if (series[0]?["data"] is not JsonArray data) return;

        json["series"] = new JsonArray(data.Select(value => value?.DeepClone()).ToArray());
    }
}