using Microsoft.AspNetCore.Components;

namespace Raptor21.RCL.Grid.Components;

/// <summary>
/// The cascaded bucket a <see cref="RaptorGrid{TRow}"/> hands to its <see cref="RaptorColumn{TRow}"/>
/// children: each column registers its built <see cref="GridColumn{TRow}"/> plus its optional markup
/// cell template here, in document order. One instance per grid render.
/// </summary>
public sealed class RaptorGridColumnCollector<TRow>
{
    private readonly List<RaptorColumnSpec<TRow>> _specs = [];

    public IReadOnlyList<RaptorColumnSpec<TRow>> Specs => _specs;

    public void Add(RaptorColumnSpec<TRow> spec) => _specs.Add(spec);
}

/// <summary>
/// One column as declared in markup: the typed <see cref="GridColumn{TRow}"/> (key, accessor, filter,
/// sizing, …) and an optional <see cref="CellTemplate"/>. When the template is present the region renders
/// it per row; otherwise it falls back to the column's <see cref="GridColumn{TRow}.Cell"/> renderer, and
/// failing that the bound member's value as text.
/// </summary>
public sealed record RaptorColumnSpec<TRow>(GridColumn<TRow> Column, RenderFragment<TRow>? CellTemplate);