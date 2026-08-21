namespace Raptor21.RCL.Forms;

/// <summary>
/// One placeholder a template author may insert from the <see cref="RaptorEditor"/> toolbar.
/// </summary>
/// <param name="Token">
/// The literal text inserted into the document, braces included — <c>{fullName}</c>. The editor wraps every
/// occurrence of such a token in a non-editable chip while in design view and unwraps it again on serialize,
/// so the host receives the plain token back.
/// </param>
/// <param name="Label">Human-readable name shown in the menu.</param>
/// <param name="Description">Optional one-line explanation shown under the label.</param>
/// <param name="IsBlock">
/// The token is replaced by whole HTML blocks at send time (table rows, a product list) rather than by an
/// inline value. The design view renders it as a dashed block placeholder so its footprint reads correctly.
/// </param>
public sealed record RaptorEditorVariable(string Token, string Label, string? Description = null, bool IsBlock = false);
