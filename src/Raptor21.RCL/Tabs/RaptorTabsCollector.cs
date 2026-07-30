using Microsoft.AspNetCore.Components;

namespace Raptor21.RCL.Tabs;

/// <summary>
/// The cascaded bucket a <see cref="RaptorTabs"/> hands to its <c>RaptorTab</c> children: each tab registers its
/// title, icon and panel content here, in document order. One instance per tabs render.
/// </summary>
public sealed class RaptorTabsCollector
{
    private readonly List<RaptorTabItem> _tabs = [];

    public IReadOnlyList<RaptorTabItem> Tabs => _tabs;

    public void Add(RaptorTabItem tab) => _tabs.Add(tab);
}

/// <summary>One tab as declared in markup: its label, optional leading icon, whether it opens active, and the
/// panel content the tabs client shows when it is selected.</summary>
public sealed record RaptorTabItem(string Title, string? Icon, bool Active, RenderFragment? Content);