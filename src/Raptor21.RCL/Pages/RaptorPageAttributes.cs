namespace Raptor21.RCL.Pages;

/// <summary>
/// Marks a <see cref="RaptorPage"/> component as a routable page rooted at its <see cref="Route"/>. Its
/// <see cref="HtmxGetAttribute"/>/<see cref="HtmxPostAttribute"/> handler methods become endpoints under this
/// path (e.g. route <c>/roles</c> + <c>[HtmxPost("grid")]</c> → <c>POST /roles/grid</c>). Registered by
/// <see cref="RaptorPageEndpoints.MapRaptorPages"/>.
/// </summary>
[AttributeUsage(AttributeTargets.Class, AllowMultiple = false)]
public class RaptorPageAttribute : Attribute
{
    public RaptorPageAttribute(string route, params string[] additionalRoutes)
    {
        Route = route;
        Routes = [route, .. additionalRoutes];
    }

    /// <summary>
    /// No route: the class gets the convention route — <c>/components/{kebab-case class name}</c>, see
    /// <see cref="RaptorRouteConvention"/>. The attribute cannot compute it (it does not know its class);
    /// the scanner and the source generator both derive it, from the same rule.
    /// </summary>
    public RaptorPageAttribute()
    {
        Route = null;
        Routes = [];
    }

    /// <summary>The page's primary base path (leading slash optional; normalised on registration) — or null
    /// for the convention route.</summary>
    public string? Route { get; }

    /// <summary>
    /// Every base path the page answers on — the primary route followed by any aliases. A page carries one
    /// component but can be reachable at several URLs (e.g. <c>"/"</c> and <c>"/home"</c>); each handler is
    /// mapped under every route here. Empty means the convention route.
    /// </summary>
    public IReadOnlyList<string> Routes { get; }
}

/// <summary>
/// Marks a routable component (a modal, a panel, …) that owns htmx routes without being a full page. The
/// endpoint scanner treats it exactly like <see cref="RaptorPageAttribute"/>.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
public class RaptorComponentAttribute : RaptorPageAttribute
{
    public RaptorComponentAttribute(string route, params string[] additionalRoutes)
        : base(route, additionalRoutes)
    {
    }

    /// <inheritdoc cref="RaptorPageAttribute()"/>
    public RaptorComponentAttribute()
    {
    }
}

/// <summary>Base for the htmx handler-method attributes. A method carrying one becomes an endpoint.</summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public abstract class HtmxHandlerAttribute(string? template) : Attribute
{
    /// <summary>Sub-path appended to the page route; null/empty means the page route itself.</summary>
    public string? Template { get; } = template;

    /// <summary>The HTTP method this handler answers.</summary>
    public abstract string Verb { get; }
}

/// <summary>Maps the method to <c>GET {page-route}/{template}</c>.</summary>
public sealed class HtmxGetAttribute(string? template = null) : HtmxHandlerAttribute(template)
{
    /// <inheritdoc/>
    public override string Verb => "GET";
}

/// <summary>Maps the method to <c>POST {page-route}/{template}</c>.</summary>
public sealed class HtmxPostAttribute(string? template = null) : HtmxHandlerAttribute(template)
{
    /// <inheritdoc/>
    public override string Verb => "POST";
}