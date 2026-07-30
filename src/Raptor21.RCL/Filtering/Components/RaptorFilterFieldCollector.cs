namespace Raptor21.RCL.Filtering.Components;

/// <summary>
/// The cascaded bucket a <see cref="RaptorFilter{TModel}"/> hands to its
/// <see cref="RaptorFilterField{TModel,TValue}"/> children: each field registers its built
/// <see cref="FilterField"/> here, in document order — the markup-driven twin of the collector
/// <see cref="Raptor21.RCL.Grid.Components.RaptorGridColumnCollector{TRow}"/> uses for grid columns.
/// One instance per filter render.
/// </summary>
public sealed class RaptorFilterFieldCollector<TModel>
{
    private readonly List<FilterField> _fields = [];

    /// <summary>
    /// TModel carries no runtime data of its own (a <see cref="FilterField"/> is model-agnostic) — it exists
    /// so the cascaded collector's type matches the owning &lt;RaptorFilter TModel="..."&gt;, exactly as
    /// <c>RaptorGridColumnCollector&lt;TRow&gt;</c> does for columns.
    /// </summary>
    public Type ModelType { get; } = typeof(TModel);

    public IReadOnlyList<FilterField> Fields => _fields;

    public void Add(FilterField field) => _fields.Add(field);
}