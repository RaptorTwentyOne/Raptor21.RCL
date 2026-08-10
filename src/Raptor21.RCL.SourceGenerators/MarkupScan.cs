using System.Text;
using System.Text.RegularExpressions;

namespace Raptor21.RCL.SourceGenerators;

/// <summary>
/// The lightweight .razor markup scan behind RFC 0001 Part 2(b)'s emission: finds
/// <c>data-rg-modal-link="&lt;id&gt;"</c> opener declarations so each becomes a generated accessor class
/// (<c>TestModal.Url</c>/<c>.Id</c>/<c>.Query</c>). Deliberately a tag-level regex, not a Razor parse — the
/// attribute value is either a literal (usable) or a razor expression (dynamic by definition, skipped).
/// Public solely for the unit tests; nothing references an analyzer assembly at runtime.
/// </summary>
public static class MarkupScan
{
    private static readonly Regex LinkAttribute = new(
        "data-rg-modal-link\\s*=\\s*\"([^\"]*)\"",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex ModalIdAttribute = new(
        "<RaptorModal\\b[^>]*?\\bId\\s*=\\s*\"([^\"]*)\"",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>Distinct literal link ids in <paramref name="markup"/>, in first-seen order. Values holding a
    /// razor expression (<c>@</c>) are dynamic and skipped; empties too.</summary>
    public static IReadOnlyList<string> ModalLinkIds(string markup) => Collect(LinkAttribute, markup);

    /// <summary>Distinct literal <c>&lt;RaptorModal Id="…"&gt;</c> ids, same rules as
    /// <see cref="ModalLinkIds"/>. Each becomes an alias accessor over the declaring routed component's own
    /// endpoint (RFC 0001 semantics (c)).</summary>
    public static IReadOnlyList<string> RaptorModalIds(string markup) => Collect(ModalIdAttribute, markup);

    private static IReadOnlyList<string> Collect(Regex pattern, string markup) =>
    [
        .. pattern.Matches(markup).Cast<Match>()
            .Select(match => match.Groups[1].Value.Trim())
            // netstandard2.0: string.Contains(char) does not exist, hence IndexOf.
            .Where(value => value.Length > 0 && value.IndexOf('@') < 0)
            .Distinct(StringComparer.Ordinal) // keeps first-seen order
    ];

    /// <summary>
    /// The generated class name for a link id: kebab/snake/dotted ids become PascalCase
    /// (<c>user-edit</c> → <c>UserEdit</c>), an already-Pascal id passes through. Null when the id cannot
    /// form a C# identifier — the caller reports a diagnostic instead of guessing.
    /// </summary>
    public static string? PascalIdentifier(string id)
    {
        var sb = new StringBuilder(id.Length);
        var upperNext = true;

        foreach (var c in id)
        {
            if (c is '-' or '_' or '.' or ' ')
            {
                upperNext = true;
                continue;
            }

            if (!char.IsLetterOrDigit(c)) return null;
            sb.Append(upperNext ? char.ToUpperInvariant(c) : c);
            upperNext = false;
        }

        if (sb.Length == 0 || !char.IsLetter(sb[0])) return null;
        return sb.ToString();
    }
}
