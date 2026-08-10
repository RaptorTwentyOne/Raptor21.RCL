// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — RizzyConfig.

using System.Diagnostics.CodeAnalysis;
using Microsoft.AspNetCore.Components;

namespace Raptor21.RCL.Composition;

/// <summary>
/// Options for the Raptor view composition: the full-page root component and the default layout applied to
/// views that don't declare their own <c>[Layout]</c>.
/// </summary>
public sealed class RaptorConfig
{
    // DynamicallyAccessedMembers(All): these types are rendered through OpenComponent(Type)/LayoutView —
    // the trimmer must keep their whole member surface, and the annotation makes every assignment carry
    // that requirement to the consumer's typeof() instead of a runtime surprise.
    [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.All)]
    private Type? _defaultLayout;

    [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.All)]
    private Type? _rootComponent = typeof(HtmxApp<EmptyLayout>);

    /// <summary>Layout applied to any view without a <see cref="LayoutAttribute"/>. Must be a Razor layout.</summary>
    [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.All)]
    public Type? DefaultLayout
    {
        get => _defaultLayout;
        set
        {
            if (value is not null && !typeof(LayoutComponentBase).IsAssignableFrom(value))
                throw new ArgumentException($"'{value}' is not a Razor layout component.", nameof(value));
            _defaultLayout = value;
        }
    }

    /// <summary>The full-page root component (the html/body shell). Must be <c>HtmxApp&lt;T&gt;</c>.</summary>
    [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.All)]
    public Type? RootComponent
    {
        get => _rootComponent;
        set
        {
            if (value is not null &&
                (!value.IsGenericType ||
                 value.GetGenericTypeDefinition() != typeof(HtmxApp<>) ||
                 !typeof(LayoutComponentBase).IsAssignableFrom(value.GetGenericArguments()[0])))
            {
                throw new ArgumentException(
                    $"'{value}' must be HtmxApp<T> where T is a LayoutComponentBase.", nameof(value));
            }

            _rootComponent = value;
        }
    }
}