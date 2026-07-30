// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — IRizzyService.

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Raptor21.RCL.Rendering;

namespace Raptor21.RCL.Mvc;

/// <summary>
/// Renders a Razor component from an MVC controller (or minimal API): <c>View</c> composes a full page
/// (root + layout + head); <c>PartialView</c> renders just the component as an htmx fragment.
/// </summary>
public interface IRaptorViewService
{
    /// <summary>The current action's path+query — a convenient default form-post target for a view.</summary>
    string CurrentActionUrl { get; }

    /// <summary>Full page, parameters via the strongly-typed builder.</summary>
    IResult View<TComponent>(Action<RaptorParameterBuilder<TComponent>> configure, ModelStateDictionary? modelState = null)
        where TComponent : IComponent;

    /// <summary>Full page, parameters from an anonymous object / dictionary (null = none).</summary>
    IResult View<TComponent>(object? data = null, ModelStateDictionary? modelState = null)
        where TComponent : IComponent;

    /// <summary>Full page, parameters from a dictionary.</summary>
    IResult View<TComponent>(Dictionary<string, object?> data, ModelStateDictionary? modelState = null)
        where TComponent : IComponent;

    /// <summary>Full page for a component known only by <see cref="Type"/> — e.g. a page rendering itself.</summary>
    IResult View(Type componentType, object? data = null, ModelStateDictionary? modelState = null);

    /// <summary>htmx fragment (no layout), parameters via the strongly-typed builder.</summary>
    IResult PartialView<TComponent>(Action<RaptorParameterBuilder<TComponent>> configure, ModelStateDictionary? modelState = null)
        where TComponent : IComponent;

    /// <summary>htmx fragment (no layout), parameters from an anonymous object / dictionary (null = none).</summary>
    IResult PartialView<TComponent>(object? data = null, ModelStateDictionary? modelState = null)
        where TComponent : IComponent;

    /// <summary>htmx fragment (no layout), parameters from a dictionary.</summary>
    IResult PartialView<TComponent>(Dictionary<string, object?> data, ModelStateDictionary? modelState = null)
        where TComponent : IComponent;
}