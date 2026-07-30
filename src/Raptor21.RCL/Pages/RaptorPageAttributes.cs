namespace Raptor21.RCL.Pages;

/// <summary>
/// Marks a <see cref="RaptorPage"/> component as a routable page rooted at <paramref name="route"/>. Its
/// <see cref="HtmxGetAttribute"/>/<see cref="HtmxPostAttribute"/> handler methods become endpoints under this
/// path (e.g. route <c>/roles</c> + <c>[HtmxPost("grid")]</c> → <c>POST /roles/grid</c>). Registered by
/// <see cref="RaptorPageEndpoints.MapRaptorPages"/>.
/// </summary>
[AttributeUsage(AttributeTargets.Class, AllowMultiple = false)]
public class RaptorPageAttribute(string route, params string[] additionalRoutes) : Attribute
{
    /// <summary>The page's primary base path (leading slash optional; normalised on registration).</summary>
    public string Route { get; } = route;

    /// <summary>
    /// Every base path the page answers on — the primary route followed by any aliases. A page carries one
    /// component but can be reachable at several URLs (e.g. <c>"/"</c> and <c>"/home"</c>); each handler is
    /// mapped under every route here.
    /// </summary>
    public IReadOnlyList<string> Routes { get; } = [route, .. additionalRoutes];
}

/// <summary>
/// Marks a routable component (a modal, a panel, …) that owns htmx routes without being a full page. The
/// endpoint scanner treats it exactly like <see cref="RaptorPageAttribute"/>.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
public class RaptorComponentAttribute(string route, params string[] additionalRoutes)
    : RaptorPageAttribute(route, additionalRoutes);

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