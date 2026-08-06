using Microsoft.AspNetCore.Components;

namespace Raptor21.RCL.Assets;

/// <summary>How the library supplies htmx, which it depends on but does not own.</summary>
public enum HtmxDelivery
{
    /// <summary>Load the bundled copy only when the page has no htmx yet. The default.</summary>
    Auto,

    /// <summary>Always load the bundled copy. Only correct when the host definitely has none.</summary>
    Always,

    /// <summary>Never load it — the host guarantees htmx itself.</summary>
    Never,
}

/// <summary>
/// Configuration for the library: asset delivery and page composition.
/// <para>
/// The defaults are chosen so that <c>AddRaptor21()</c> with no arguments produces a working page: the
/// stylesheet and bundle are injected automatically and htmx is supplied only if missing. A host that
/// wants to take over any part of that opts out here rather than by editing a layout.
/// </para>
/// </summary>
public sealed class RaptorOptions
{
    /// <summary>
    /// URL prefix the embedded assets are served under. Changing it is only necessary if it collides
    /// with a host route; it must not contain a trailing slash.
    /// </summary>
    public string RoutePrefix { get; set; } = "/_raptor21";

    /// <summary>
    /// Inject the stylesheet and bundle into every HTML response. Turn this off only to place the tags
    /// by hand, which forfeits the content-hashed URLs the manifest resolves.
    /// </summary>
    public bool InjectAssets { get; set; } = true;

    /// <inheritdoc cref="HtmxDelivery"/>
    public HtmxDelivery Htmx { get; set; } = HtmxDelivery.Auto;

    /// <summary>
    /// Serve assets with an immutable, one-year cache. Safe because every filename carries a content
    /// hash — a changed file is a different URL. Disable only when debugging the pipeline itself.
    /// </summary>
    public bool ImmutableCaching { get; set; } = true;

    /// <summary>
    /// The full-page root component (the html/body shell). Must be <c>HtmxApp&lt;T&gt;</c> where <c>T</c> is
    /// the host's layout; validated when the composition options are first read. Null keeps the library
    /// default (<c>HtmxApp&lt;EmptyLayout&gt;</c>).
    /// </summary>
    public Type? RootComponent { get; set; }

    /// <summary>
    /// Layout applied to any page without a <see cref="LayoutAttribute"/>. Must be a Razor layout;
    /// validated when the composition options are first read. Null means no default layout.
    /// </summary>
    public Type? DefaultLayout { get; set; }
}
