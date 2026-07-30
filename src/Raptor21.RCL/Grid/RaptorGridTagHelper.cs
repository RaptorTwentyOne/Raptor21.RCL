using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.AspNetCore.Razor.TagHelpers;

namespace Raptor21.RCL.Grid;

/// <summary>
/// Declares a grid in markup — the same region the fluent
/// <c>@await Html.PartialAsync(RaptorGridPartials.Region, await Model.BuildGridAsync(Model))</c> produces,
/// but written as a tag so a page reads like markup rather than a render call. It belongs to the same
/// declarative family as <c>&lt;raptor-modal&gt;</c>, <c>&lt;raptor-select&gt;</c> and the form controls.
/// <list type="bullet">
/// <item><c>&lt;raptor-grid /&gt;</c> — the page is its own <see cref="IGridSource{TRow}"/> (the common
/// single-grid page); the grid is built here from the page's own model.</item>
/// <item><c>&lt;raptor-grid for="@Model.OrdersSource" handler="OrdersGrid" /&gt;</c> — a specific source
/// and its named handler, for a page that hosts more than one grid.</item>
/// <item><c>&lt;raptor-grid view="@Model.OrdersGrid" /&gt;</c> — render a grid the page already built in
/// its <c>OnGet</c> (a detail tab that pre-loads several grids), skipping the build here.</item>
/// </list>
/// </summary>
[HtmlTargetElement("raptor-grid")]
public sealed class RaptorGridTagHelper(IHtmlHelper html) : TagHelper
{
    [HtmlAttributeNotBound, ViewContext] public ViewContext ViewContext { get; set; } = default!;

    /// <summary>A grid the page already built (e.g. in <c>OnGet</c>). When set, no source/handler is used.</summary>
    public GridViewModel? View { get; set; }

    /// <summary>The <see cref="IGridSource{TRow}"/> to build from. Omit to use the page itself, which is
    /// the source on a single-grid page.</summary>
    public object? For { get; set; }

    /// <summary>The page handler this grid posts to. A multi-grid page gives each grid a distinct name.</summary>
    public string Handler { get; set; } = RaptorGridPageExtensions.GridHandler;

    public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        output.TagName = null;

        var model = View;
        if (model is null)
        {
            if (ViewContext.ViewData.Model is not PageModel page)
            {
                output.SuppressOutput();
                return;
            }

            model = await page.BuildGridAsync(For ?? page, Handler);
        }

        (html as IViewContextAware)?.Contextualize(ViewContext);
        output.Content.SetHtmlContent(await html.PartialAsync(RaptorGridPartials.Region, model));
    }
}
