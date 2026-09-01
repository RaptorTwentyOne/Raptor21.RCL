namespace Raptor21.RCL.Feedback;

/// <summary>
/// What a piece of status is SAYING, not what colour it is.
///
/// One enum for every surface that reports state inline — <see cref="RaptorNote"/> and
/// <see cref="RaptorBadge"/> today. They share it deliberately: a consuming application that colours a
/// failed row's badge red and its explanatory note some other red has two vocabularies for one fact, and
/// the reader has to learn both. Each member resolves to the matching
/// <c>--rg-&lt;tone&gt;-fg / -bg / -border</c> trio, so a host retones the whole system by overriding three
/// custom properties per tone rather than restyling components.
///
/// <para>This is NOT <c>ButtonVariant</c>. A button's variant says how loud an ACTION is; a tone says what
/// a piece of INFORMATION means. They overlap in colour and in nothing else — a Ghost button has no tone,
/// and a Neutral badge is not a quiet button.</para>
/// </summary>
public enum Tone
{
    /// <summary>
    /// A plain fact, carrying no judgement: a category, a type, a state that is neither good nor bad
    /// ("web", "mobile", "draft"). The default, and in practice the most common — do not reach for a
    /// colour just because a value is important.
    /// </summary>
    Neutral,

    /// <summary>Context the reader may not have: an explanation, a definition, a "what this screen shows".</summary>
    Info,

    /// <summary>Something completed, is healthy, or is active.</summary>
    Success,

    /// <summary>Something needs attention but still works: a deprecation, a soft limit, a degraded reading.</summary>
    Warning,

    /// <summary>Something failed, is blocked, or will lose data. The only tone that defaults to an alert role.</summary>
    Danger,
}
