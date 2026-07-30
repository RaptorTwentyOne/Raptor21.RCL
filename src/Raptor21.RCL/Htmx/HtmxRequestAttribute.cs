// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT).

using Microsoft.AspNetCore.Mvc.ActionConstraints;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Raptor21.RCL.Htmx;

/// <summary>
/// Constrains an MVC action so it is only selected for htmx requests. Lets a single route have one action for
/// a full navigation and another (decorated with this) for the htmx fragment.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class HtmxRequestAttribute : ActionFilterAttribute, IActionConstraint
{
    int IActionConstraint.Order => 0;

    /// <summary>If set, the action is selected only when the htmx target id matches this value.</summary>
    public string? Target { get; set; }

    bool IActionConstraint.Accept(ActionConstraintContext context)
    {
        var request = new HtmxRequest(context.RouteContext.HttpContext);
        return request.IsHtmx && (Target is null || request.TargetId == Target);
    }
}
