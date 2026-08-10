using Microsoft.AspNetCore.Http;

namespace Raptor21.RCL.Pages;

/// <summary>
/// The one bridge generated handler invokers need: <see cref="RaptorPage.AttachContext"/> is internal (a page's
/// HttpContext is set by infrastructure, never by user code), and the generated registration lives in the
/// CONSUMER assembly, which could not call it. Everything else the generated code does — construct the page,
/// bind parameters, call the handler — is ordinary public-surface C#.
/// </summary>
public static class RaptorPageInvoker
{
    /// <summary>Attaches the current request to a freshly constructed page and hands it back — the generated
    /// invoker's first line. The constraint is also the first honest compile error a non-<see cref="RaptorPage"/>
    /// class with a route attribute gets (the reflective scanner just skips those silently).</summary>
    public static TPage Prepare<TPage>(TPage page, HttpContext httpContext) where TPage : RaptorPage
    {
        page.AttachContext(httpContext);
        return page;
    }
}
