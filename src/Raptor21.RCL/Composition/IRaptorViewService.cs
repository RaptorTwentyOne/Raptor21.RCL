// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — IRizzyService.

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Raptor21.RCL.Rendering;

namespace Raptor21.RCL.Composition;

/// <summary>
/// Renders a Razor component as an <see cref="IResult"/>: <c>View</c> composes a full page
/// (root + layout + head); <c>PartialView</c> renders just the component as an htmx fragment.
/// The render seam behind <c>RaptorPage.Page()</c> / <c>Partial()</c>.
/// </summary>
public interface IRaptorViewService
{
    /// <summary>The current request's path+query — a convenient default form-post target for a view.</summary>
    string CurrentActionUrl { get; }

    /// <summary>Full page, parameters via the strongly-typed builder.</summary>
    IResult View<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(Action<RaptorParameterBuilder<TComponent>> configure, ModelStateDictionary? modelState = null)
        where TComponent : IComponent;

    /// <summary>Full page, parameters from an anonymous object / dictionary (null = none).</summary>
    IResult View<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(object? data = null, ModelStateDictionary? modelState = null)
        where TComponent : IComponent;

    /// <summary>Full page, parameters from a dictionary.</summary>
    IResult View<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(Dictionary<string, object?> data, ModelStateDictionary? modelState = null)
        where TComponent : IComponent;

    /// <summary>Full page for a component known only by <see cref="Type"/> — e.g. a page rendering itself.</summary>
    IResult View([System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] Type componentType, object? data = null, ModelStateDictionary? modelState = null);

    /// <summary>htmx fragment (no layout), parameters via the strongly-typed builder.</summary>
    IResult PartialView<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(Action<RaptorParameterBuilder<TComponent>> configure, ModelStateDictionary? modelState = null)
        where TComponent : IComponent;

    /// <summary>htmx fragment (no layout), parameters from an anonymous object / dictionary (null = none).</summary>
    IResult PartialView<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(object? data = null, ModelStateDictionary? modelState = null)
        where TComponent : IComponent;

    /// <summary>htmx fragment (no layout), parameters from a dictionary.</summary>
    IResult PartialView<[System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembers(System.Diagnostics.CodeAnalysis.DynamicallyAccessedMemberTypes.All)] TComponent>(Dictionary<string, object?> data, ModelStateDictionary? modelState = null)
        where TComponent : IComponent;
}
