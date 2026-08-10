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

using System.Reflection;
using System.Runtime.Serialization;
using System.Text.Json;
using System.Text.Json.Serialization;

using Raptor21.RCL.Charts.Models;

namespace Raptor21.RCL.Charts.Serialization
{
    /// <summary>
    /// Facilitates serialization of enum values
    /// </summary>
    /// <remarks>
    /// <see href="https://stackoverflow.com/questions/59059989/system-text-json-how-do-i-specify-a-custom-name-for-an-enum-value">Stackoverflow Discussion</see>
    /// </remarks>
    public class CustomJsonStringEnumConverter : JsonConverterFactory
    {
        private readonly JsonNamingPolicy namingPolicy;
        private readonly bool allowIntegerValues;
        private readonly JsonStringEnumConverter baseConverter;

        public CustomJsonStringEnumConverter() : this(null, true) { }

        public CustomJsonStringEnumConverter(JsonNamingPolicy namingPolicy = null, bool allowIntegerValues = true)
        {
            this.namingPolicy = namingPolicy;
            this.allowIntegerValues = allowIntegerValues;
            this.baseConverter = new JsonStringEnumConverter(namingPolicy, allowIntegerValues);
        }

        /// <inheritdoc/>
        public override bool CanConvert(Type typeToConvert) => baseConverter.CanConvert(typeToConvert);

        /// <inheritdoc/>
        public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options)
        {
            var query = from field in typeToConvert.GetFields(BindingFlags.Public | BindingFlags.Static)
                        let attr = field.GetCustomAttribute<EnumMemberAttribute>()
                        where attr != null
                        select (field.Name, attr.Value);

            var dictionary = query.ToDictionary(p => p.Item1, p => p.Item2);

            if (dictionary.Count > 0)
            {
                return new JsonStringEnumConverter(new DictionaryLookupNamingPolicy(dictionary, namingPolicy), allowIntegerValues).CreateConverter(typeToConvert, options);
            }
            else
            {
                return new JsonStringEnumConverter(JsonNamingPolicy.CamelCase).CreateConverter(typeToConvert, options);
            }
        }
    }

    internal class JsonNamingPolicyDecorator : JsonNamingPolicy
    {
        readonly JsonNamingPolicy underlyingNamingPolicy;

        internal JsonNamingPolicyDecorator(JsonNamingPolicy underlyingNamingPolicy) => this.underlyingNamingPolicy = underlyingNamingPolicy;

        /// <inheritdoc/>
        public override string ConvertName(string name) => underlyingNamingPolicy == null ? name : underlyingNamingPolicy.ConvertName(name);
    }

    internal class DictionaryLookupNamingPolicy : JsonNamingPolicyDecorator
    {
        readonly Dictionary<string, string> dictionary;

        public DictionaryLookupNamingPolicy(Dictionary<string, string> dictionary, JsonNamingPolicy underlyingNamingPolicy) : base(underlyingNamingPolicy) => this.dictionary = dictionary ?? throw new ArgumentNullException();

        /// <inheritdoc/>
        public override string ConvertName(string name) => dictionary.TryGetValue(name, out var value) ? value : base.ConvertName(name);
    }
}
