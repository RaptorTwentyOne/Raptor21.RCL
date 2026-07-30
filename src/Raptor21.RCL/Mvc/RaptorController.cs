// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — RzController.

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Extensions.DependencyInjection;
using Raptor21.RCL.Rendering;

namespace Raptor21.RCL.Mvc;

/// <summary>
/// Base controller that renders Razor components as views: <c>View&lt;T&gt;()</c> for a full page,
/// <c>PartialView&lt;T&gt;()</c> for an htmx fragment. Co-locate <c>Controller.cs</c> with its
/// <c>Views/*.razor</c> component views.
/// When <c>modelState</c> is omitted, both default to the controller's own <see cref="ControllerBase.ModelState"/>,
/// so validation errors reach the view without each action passing it explicitly.
/// </summary>
public abstract class RaptorController : ControllerBase
{
    private IRaptorViewService? _views;

    /// <summary>The view-rendering service for the current request.</summary>
    protected IRaptorViewService Views => _views ??= HttpContext.RequestServices.GetRequiredService<IRaptorViewService>();

    /// <summary>The current action's path+query — a convenient default form-post target for a view.</summary>
    protected string CurrentActionUrl => Views.CurrentActionUrl;

    /// <summary>Full page, parameters via the strongly-typed builder.</summary>
    [NonAction]
    public virtual IResult View<TComponent>(Action<RaptorParameterBuilder<TComponent>> configure, ModelStateDictionary? modelState = null)
        where TComponent : IComponent => Views.View(configure, modelState ?? ModelState);

    /// <summary>Full page, parameters from an anonymous object / dictionary (null = none).</summary>
    [NonAction]
    public virtual IResult View<TComponent>(object? data = null, ModelStateDictionary? modelState = null)
        where TComponent : IComponent => Views.View<TComponent>(data, modelState ?? ModelState);

    /// <summary>Full page, parameters from a dictionary.</summary>
    [NonAction]
    public virtual IResult View<TComponent>(Dictionary<string, object?> data, ModelStateDictionary? modelState = null)
        where TComponent : IComponent => Views.View<TComponent>(data, modelState ?? ModelState);

    /// <summary>htmx fragment (no layout), parameters via the strongly-typed builder.</summary>
    [NonAction]
    public virtual IResult PartialView<TComponent>(Action<RaptorParameterBuilder<TComponent>> configure, ModelStateDictionary? modelState = null)
        where TComponent : IComponent => Views.PartialView(configure, modelState ?? ModelState);

    /// <summary>htmx fragment (no layout), parameters from an anonymous object / dictionary (null = none).</summary>
    [NonAction]
    public virtual IResult PartialView<TComponent>(object? data = null, ModelStateDictionary? modelState = null)
        where TComponent : IComponent => Views.PartialView<TComponent>(data, modelState ?? ModelState);

    /// <summary>htmx fragment (no layout), parameters from a dictionary.</summary>
    [NonAction]
    public virtual IResult PartialView<TComponent>(Dictionary<string, object?> data, ModelStateDictionary? modelState = null)
        where TComponent : IComponent => Views.PartialView<TComponent>(data, modelState ?? ModelState);
}
