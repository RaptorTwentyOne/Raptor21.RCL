using System.Text;

namespace Raptor21.RCL.Pages;

/// <summary>
/// The convention route for a <see cref="RaptorPageAttribute"/>/<see cref="RaptorComponentAttribute"/> class
/// that declares no route of its own: <c>/components/{kebab-case type name}</c>. One rule, no exceptions —
/// no suffix stripping, no per-kind prefixes — because guessing intent from a name suffix is where
/// conventions rot (RFC 0001, Part 1).
///
/// PARITY CONTRACT: the source generator carries a byte-for-byte copy of <see cref="Kebab"/>
/// (a netstandard2.0 analyzer cannot reference this net10.0 assembly). Any change here MUST be mirrored in
/// <c>Raptor21.RCL.SourceGenerators.RouteConvention</c>; the parity test in Raptor21.RCL.Tests holds the
/// two implementations to identical output over a shared corpus.
/// </summary>
public static class RaptorRouteConvention
{
    public const string Prefix = "/components/";

    /// <summary>The convention route for <paramref name="typeName"/> (a simple class name, no namespace).</summary>
    public static string RouteFor(string typeName) => Prefix + Kebab(typeName);

    /// <summary>
    /// PascalCase → kebab-case with acronym handling: a word boundary opens before an upper-case letter that
    /// follows a non-upper character, or that starts an acronym's last letter (upper followed by lower). So
    /// <c>PageGroupModal</c> → <c>page-group-modal</c>, <c>EPCModal</c> → <c>epc-modal</c>,
    /// <c>Vkorg21Panel</c> → <c>vkorg21-panel</c>.
    /// </summary>
    public static string Kebab(string typeName)
    {
        var sb = new StringBuilder(typeName.Length + 8);

        for (var i = 0; i < typeName.Length; i++)
        {
            var c = typeName[i];
            if (char.IsUpper(c))
            {
                var boundary = i > 0 &&
                               (!char.IsUpper(typeName[i - 1]) ||
                                (i + 1 < typeName.Length && char.IsLower(typeName[i + 1])));
                if (boundary) sb.Append('-');
                sb.Append(char.ToLowerInvariant(c));
            }
            else
            {
                sb.Append(c);
            }
        }

        return sb.ToString();
    }
}
