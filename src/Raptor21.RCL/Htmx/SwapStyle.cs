// Adapted from Rizzy (https://github.com/JalexSocial/Rizzy, MIT) — htmx 4 swap styles.

namespace Raptor21.RCL.Htmx;

/// <summary>
/// How the response is swapped into the target element. Casing matches the htmx attribute values so the names
/// can be used directly in markup.
/// </summary>
public enum SwapStyle
{
    /// <summary>Use the application/htmx default swap style (cannot be emitted directly).</summary>
    Default,

    /// <summary>Replace the inner html of the target.</summary>
    innerHTML,

    /// <summary>Replace the entire target element.</summary>
    outerHTML,

    /// <summary>Insert before the target element.</summary>
    beforebegin,

    /// <summary>Insert before the first child of the target.</summary>
    afterbegin,

    /// <summary>Insert after the last child of the target.</summary>
    beforeend,

    /// <summary>Insert after the target element.</summary>
    afterend,

    /// <summary>Delete the target regardless of the response.</summary>
    delete,

    /// <summary>Append nothing (out-of-band items are still processed).</summary>
    none,

    /// <summary>htmx 4 morph of the inner html.</summary>
    innerMorph,

    /// <summary>htmx 4 morph of the outer html.</summary>
    outerMorph,

    /// <summary>htmx 4 text-content swap.</summary>
    textContent,

    /// <summary>htmx 4 before.</summary>
    before,

    /// <summary>htmx 4 after.</summary>
    after,

    /// <summary>htmx 4 prepend.</summary>
    prepend,

    /// <summary>htmx 4 append.</summary>
    append,
}

/// <summary>Extensions for <see cref="SwapStyle"/>.</summary>
public static class SwapStyleExtensions
{
    /// <summary>Converts the swap style to the string htmx expects. <see cref="SwapStyle.Default"/> maps to "".</summary>
    public static string ToHtmxString(this SwapStyle swapStyle) => swapStyle switch
    {
        SwapStyle.Default => string.Empty,
        SwapStyle.innerHTML => "innerHTML",
        SwapStyle.outerHTML => "outerHTML",
        SwapStyle.beforebegin => "beforebegin",
        SwapStyle.afterbegin => "afterbegin",
        SwapStyle.beforeend => "beforeend",
        SwapStyle.afterend => "afterend",
        SwapStyle.delete => "delete",
        SwapStyle.none => "none",
        SwapStyle.innerMorph => "innerMorph",
        SwapStyle.outerMorph => "outerMorph",
        SwapStyle.textContent => "textContent",
        SwapStyle.before => "before",
        SwapStyle.after => "after",
        SwapStyle.prepend => "prepend",
        SwapStyle.append => "append",
        _ => throw new ArgumentOutOfRangeException(nameof(swapStyle), swapStyle, null),
    };
}
