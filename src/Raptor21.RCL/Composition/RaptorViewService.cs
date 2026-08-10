// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — RizzyService.

using System.Reflection;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Extensions;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Raptor21.RCL.Htmx;
using Raptor21.RCL.Rendering;

namespace Raptor21.RCL.Composition;

/// <inheritdoc cref="IRaptorViewService"/>
public sealed class RaptorViewService(IHttpContextAccessor httpContextAccessor) : IRaptorViewService
{
    private string? _currentActionUrl;

    private HttpContext Http => httpContextAccessor.HttpContext
                                ?? throw new InvalidOperationException("No active HttpContext. Use RaptorViewService within a request scope.");

    /// <inheritdoc/>
    public string CurrentActionUrl => _currentActionUrl ??= Http.Request.GetEncodedPathAndQuery();

    /// <inheritdoc/>
    public IResult View<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(Action<RaptorParameterBuilder<TComponent>> configure, ModelStateDictionary? modelState = null)
        where TComponent : IComponent =>
        View<TComponent>(Build(configure), modelState);

    /// <inheritdoc/>
    public IResult View<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(object? data = null, ModelStateDictionary? modelState = null) where TComponent : IComponent =>
        View<TComponent>(ToDictionary(data), modelState);

    /// <inheritdoc/>
    public IResult View<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(Dictionary<string, object?> data, ModelStateDictionary? modelState = null) where TComponent : IComponent =>
        RenderCore(typeof(TComponent), data, modelState, RaptorViewMode.Page, preventStreaming: false);

    /// <inheritdoc/>
    public IResult View([System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] Type componentType, object? data = null, ModelStateDictionary? modelState = null) =>
        RenderCore(componentType, ToDictionary(data), modelState, RaptorViewMode.Page, preventStreaming: false);

    /// <inheritdoc/>
    public IResult PartialView<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(Action<RaptorParameterBuilder<TComponent>> configure, ModelStateDictionary? modelState = null)
        where TComponent : IComponent =>
        PartialView<TComponent>(Build(configure), modelState);

    /// <inheritdoc/>
    public IResult PartialView<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(object? data = null, ModelStateDictionary? modelState = null) where TComponent : IComponent =>
        PartialView<TComponent>(ToDictionary(data), modelState);

    /// <inheritdoc/>
    public IResult PartialView<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(Dictionary<string, object?> data, ModelStateDictionary? modelState = null) where TComponent : IComponent =>
        RenderCore(typeof(TComponent), data, modelState, RaptorViewMode.Partial, preventStreaming: true);

    [System.Diagnostics.CodeAnalysis.UnconditionalSuppressMessage("Trimming", "IL2110",
        Justification = "RaptorView's annotated members are set by RazorComponentResult through ParameterView; the values placed in the dictionary flow from DAM-annotated sources in this method.")]
    [System.Diagnostics.CodeAnalysis.UnconditionalSuppressMessage("Trimming", "IL2111",
        Justification = "Same ParameterView hand-off; every value originates from a DAM(All)-annotated parameter of this method.")]
    private IResult RenderCore([System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] Type componentType, Dictionary<string, object?> data, ModelStateDictionary? modelState, RaptorViewMode mode, bool preventStreaming)
    {
        if (Http.Response.Htmx().EmptyResponseBodyRequested)
            return Results.NoContent();

        var parameters = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["ComponentType"] = componentType,
            ["ComponentParameters"] = data,
            ["ModelState"] = modelState,
            ["Mode"] = mode,
        };

        return new RazorComponentResult<RaptorView>(parameters) { PreventStreamingRendering = preventStreaming };
    }

    private static Dictionary<string, object?> Build<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(Action<RaptorParameterBuilder<TComponent>> configure)
        where TComponent : IComponent
    {
        ArgumentNullException.ThrowIfNull(configure);
        var builder = new RaptorParameterBuilder<TComponent>();
        configure(builder);
        return builder.Build();
    }

    // Reflection over `data` runs ONLY for the anonymous-object convenience path — null and dictionary
    // inputs (every library-internal call) never reach it. An anonymous type's members are rooted by its
    // call-site construction; a trimmed consumer passing a named POCO must keep it rooted. Prefer the typed
    // builder overload.
    [System.Diagnostics.CodeAnalysis.UnconditionalSuppressMessage("Trimming", "IL2075",
        Justification = "Null/dictionary paths are reflection-free; anonymous-object members are rooted by their call-site construction.")]
    private static Dictionary<string, object?> ToDictionary(object? data)
    {
        if (data is null)
            return new Dictionary<string, object?>(StringComparer.Ordinal);
        if (data is IDictionary<string, object?> dict)
            return new Dictionary<string, object?>(dict, StringComparer.Ordinal);

        var result = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var property in data.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance)
                     .Where(property => property.CanRead))
            result[property.Name] = property.GetValue(data);
        return result;
    }
}
