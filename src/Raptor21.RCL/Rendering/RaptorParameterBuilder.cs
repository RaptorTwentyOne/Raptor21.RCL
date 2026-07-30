// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — RizzyComponentParameterBuilder.

using System.Linq.Expressions;
using System.Reflection;
using Microsoft.AspNetCore.Components;

namespace Raptor21.RCL.Rendering;

/// <summary>
/// A fluent, strongly-typed builder for the parameter dictionary passed to a Razor component when it is
/// rendered to a fragment/page (see <c>RaptorResults.Component&lt;T&gt;</c>). Each parameter is selected by a
/// property expression, so a typo or a non-<c>[Parameter]</c> property fails at build time rather than being
/// silently dropped by <see cref="ParameterView"/>. Reflection metadata is cached per component type.
/// </summary>
/// <typeparam name="TComponent">The component the parameters target. Must implement <see cref="IComponent"/>.</typeparam>
public sealed class RaptorParameterBuilder<TComponent> where TComponent : IComponent
{
    private static readonly Type ComponentType = typeof(TComponent);

    private readonly Dictionary<string, object?> _parameters = new(StringComparer.Ordinal);
    private readonly IReadOnlyList<ParameterMetadata> _metadata = ComponentMetadataCache.GetParameterMetadata(ComponentType);

    /// <summary>Adds or updates a parameter, validating the value against the parameter's declared type.</summary>
    /// <param name="parameterSelector">Property access expression identifying the parameter, e.g. <c>c =&gt; c.Title</c>.</param>
    /// <param name="value">The value to assign.</param>
    public RaptorParameterBuilder<TComponent> Add<TValue>(
        Expression<Func<TComponent, TValue>> parameterSelector, TValue value)
    {
        ArgumentNullException.ThrowIfNull(parameterSelector);

        if (parameterSelector.Body is not MemberExpression { Member: PropertyInfo selectedProperty })
        {
            throw new ArgumentException(
                "The parameter selector must be a simple property access expression (e.g. c => c.MyProperty).",
                nameof(parameterSelector));
        }

        var propertyName = selectedProperty.Name;
        var meta = _metadata.FirstOrDefault(p => p.Name.Equals(propertyName, StringComparison.Ordinal));
        if (meta is null)
        {
            throw new ArgumentException(
                $"Property '{propertyName}' is not a recognized [Parameter] on component '{ComponentType.FullName}'. " +
                "Ensure the property is public, on the component or a qualifying base class, and decorated with [Parameter].",
                nameof(parameterSelector));
        }

        ValidateAssignable(propertyName, meta.ParameterType, value);
        _parameters[propertyName] = value;
        return this;
    }

    private static void ValidateAssignable<TValue>(string propertyName, Type expectedType, TValue value)
    {
        if (value is null)
        {
            if (expectedType.IsValueType && Nullable.GetUnderlyingType(expectedType) is null)
                throw new ArgumentException(
                    $"Cannot assign null to non-nullable value-type parameter '{propertyName}' of type '{expectedType.FullName}'.");
            return;
        }

        var actualType = value.GetType();
        if (expectedType.IsAssignableFrom(actualType))
            return;

        if (Nullable.GetUnderlyingType(expectedType) is { } underlying && underlying == actualType)
            return;

        throw new ArgumentException(
            $"Type mismatch for parameter '{propertyName}'. Component expects a type assignable to " +
            $"'{expectedType.FullName}' but the value is of type '{actualType.FullName}'.");
    }

    /// <summary>Adds the standard <c>ChildContent</c> <see cref="RenderFragment"/> parameter.</summary>
    public RaptorParameterBuilder<TComponent> AddChildContent(RenderFragment? childContent)
    {
        const string name = "ChildContent";
        var meta = _metadata.FirstOrDefault(p => p.Name.Equals(name, StringComparison.Ordinal));
        if (meta is null)
            throw new InvalidOperationException($"Component '{ComponentType.FullName}' has no [Parameter] named '{name}'.");
        if (meta.ParameterType != typeof(RenderFragment))
            throw new InvalidOperationException(
                $"The '{name}' parameter on '{ComponentType.FullName}' is not a {nameof(RenderFragment)} (it is '{meta.ParameterType.FullName}').");

        _parameters[name] = childContent;
        return this;
    }

    /// <summary>Adds <c>ChildContent</c> from a raw markup string.</summary>
    public RaptorParameterBuilder<TComponent> AddChildContent(string? markup) =>
        AddChildContent(builder => builder.AddMarkupContent(0, markup));

    /// <summary>Adds an <see cref="EventCallback"/> parameter. A null callback becomes a no-op callback.</summary>
    public RaptorParameterBuilder<TComponent> Add(Expression<Func<TComponent, EventCallback>> selector, Action? callback) =>
        Add(selector, EventCallback.Factory.Create(callback?.Target ?? this, callback ?? (() => { })));

    public RaptorParameterBuilder<TComponent> Add(Expression<Func<TComponent, EventCallback>> selector, Func<Task>? callback) =>
        Add(selector, EventCallback.Factory.Create(callback?.Target ?? this, callback ?? (() => Task.CompletedTask)));

    public RaptorParameterBuilder<TComponent> Add<TArg>(Expression<Func<TComponent, EventCallback<TArg>>> selector, Action<TArg>? callback) =>
        Add(selector, EventCallback.Factory.Create<TArg>(callback?.Target ?? this, callback ?? (_ => { })));

    public RaptorParameterBuilder<TComponent> Add<TArg>(Expression<Func<TComponent, EventCallback<TArg>>> selector, Func<TArg, Task>? callback) =>
        Add(selector, EventCallback.Factory.Create<TArg>(callback?.Target ?? this, callback ?? (_ => Task.CompletedTask)));

    /// <summary>
    /// Builds the parameter dictionary, enforcing that every <see cref="EditorRequiredAttribute"/> parameter was
    /// set (Blazor only enforces that at compile time, not at runtime, so the builder does it here).
    /// </summary>
    public Dictionary<string, object?> Build()
    {
        foreach (var meta in _metadata)
        {
            if (meta.IsEditorRequired && !_parameters.ContainsKey(meta.Name))
                throw new ArgumentException(
                    $"Required parameter '{meta.Name}' for component '{ComponentType.FullName}' was not provided " +
                    "(it is marked [EditorRequired]).");
        }

        return new Dictionary<string, object?>(_parameters, StringComparer.Ordinal);
    }
}
