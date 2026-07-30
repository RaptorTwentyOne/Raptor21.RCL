// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — ComponentMetadataCache + ParameterMetadata.

using System.Collections.Concurrent;
using System.Reflection;
using Microsoft.AspNetCore.Components;

namespace Raptor21.RCL.Rendering;

/// <summary>Metadata for one Razor component <c>[Parameter]</c> property.</summary>
/// <param name="Name">The parameter name.</param>
/// <param name="PropertyInfo">Reflection info for the property.</param>
/// <param name="ParameterType">The parameter's .NET type.</param>
/// <param name="IsEditorRequired">Whether it is marked <see cref="EditorRequiredAttribute"/>.</param>
internal sealed record ParameterMetadata(
    string Name,
    PropertyInfo PropertyInfo,
    Type ParameterType,
    bool IsEditorRequired);

/// <summary>
/// Thread-safe, per-type cache of a component's <c>[Parameter]</c> metadata, used by
/// <see cref="RaptorParameterBuilder{TComponent}"/>. Bounded by the number of component types in the app.
/// </summary>
internal static class ComponentMetadataCache
{
    private static readonly ConcurrentDictionary<Type, IReadOnlyList<ParameterMetadata>> Cache = new();
    private static readonly Type ComponentBaseType = typeof(ComponentBase);

    public static IReadOnlyList<ParameterMetadata> GetParameterMetadata(Type componentType) =>
        Cache.GetOrAdd(componentType, Calculate);

    private static IReadOnlyList<ParameterMetadata> Calculate(Type componentType)
    {
        var parameters = new List<ParameterMetadata>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        for (var type = componentType;
             type is not null && type != typeof(object) && type != ComponentBaseType;
             type = type.BaseType)
        {
            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                if (property.GetCustomAttribute<ParameterAttribute>(inherit: false) is null)
                    continue;
                if (!seen.Add(property.Name))
                    continue;

                parameters.Add(new ParameterMetadata(
                    property.Name,
                    property,
                    property.PropertyType,
                    IsEditorRequired: property.GetCustomAttribute<EditorRequiredAttribute>(inherit: false) is not null));
            }
        }

        return parameters.AsReadOnly();
    }
}
