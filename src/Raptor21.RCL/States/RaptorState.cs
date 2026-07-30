namespace Raptor21.RCL.States;

/// <summary>
/// Which of a component's mutually exclusive presentation states is showing.
/// <para>
/// The state is named on the server, so the correct pane is on screen in the first byte with no script
/// involved. The client can still switch states at runtime; this decides only where a component starts.
/// </para>
/// </summary>
public enum RaptorState
{
    /// <summary>The real thing — rows, a chart, a form.</summary>
    Content,

    /// <summary>Data is on its way. A skeleton, usually.</summary>
    Loading,

    /// <summary>The request succeeded and there is genuinely nothing to show.</summary>
    Empty,

    /// <summary>The data could not be obtained. Distinct from <see cref="Empty"/>, which means the request
    /// succeeded and returned nothing.</summary>
    Error,
}

/// <summary>Wire names for <see cref="RaptorState"/>, shared with the client.</summary>
public static class RaptorStateNames
{
    /// <summary>The attribute a state pane carries: <c>data-rg-state="loading"</c>.</summary>
    public const string Attribute = "data-rg-state";

    /// <summary>The attribute the host element carries, naming the state currently showing.</summary>
    public const string HostAttribute = "data-rg-state-host";

    /// <summary>The lower-case wire name the client compares against.</summary>
    public static string Wire(this RaptorState state) => state switch
    {
        RaptorState.Content => "content",
        RaptorState.Loading => "loading",
        RaptorState.Empty => "empty",
        RaptorState.Error => "error",
        _ => "content",
    };
}
