namespace Raptor21.RCL.Forms;

/// <summary>When the button is filled, outlined, quiet, or an icon.</summary>
public enum ButtonVariant
{
    /// <summary>The default: an outlined, neutral button.</summary>
    Secondary,
    /// <summary>The primary action of a form or dialog — one per group.</summary>
    Primary,
    /// <summary>A destructive action.</summary>
    Danger,
    /// <summary>A confirming/positive action.</summary>
    Success,
    /// <summary>A cautioning action.</summary>
    Warning,
    /// <summary>An informational action.</summary>
    Info,
    /// <summary>A soft, low-contrast neutral fill.</summary>
    Light,
    /// <summary>Outlined in the accent colour, filling in on hover — the "outline-primary" look.</summary>
    Outline,
    /// <summary>No border or fill until hovered — for low-emphasis actions in dense rows.</summary>
    Ghost,
}

public enum ButtonSize
{
    Small,
    Medium,
    Large,
}
