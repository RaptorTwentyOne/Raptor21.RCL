namespace Raptor21.RCL.Forms;

/// <summary>The view a <see cref="RaptorEditor"/> opens in. Client state only — it is never posted back.</summary>
public enum RaptorEditorMode
{
    /// <summary>The visual (WYSIWYG) view — the document rendered inside an editable iframe.</summary>
    Design,
    /// <summary>The raw HTML source in a textarea.</summary>
    Source,
}
