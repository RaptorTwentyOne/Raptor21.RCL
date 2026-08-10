using System.Text;

namespace Raptor21.RCL.SourceGenerators;

/// <summary>
/// BYTE-FOR-BYTE copy of <c>Raptor21.RCL.Pages.RaptorRouteConvention</c> — a netstandard2.0 analyzer cannot
/// reference the net10.0 library, so the convention lives twice. Any change there MUST land here too; the
/// parity test in Raptor21.RCL.Tests holds both implementations to identical output over a shared corpus.
/// Public solely so that test can reach it — nothing references an analyzer assembly at runtime.
/// </summary>
public static class RouteConvention
{
    public const string Prefix = "/components/";

    public static string RouteFor(string typeName) => Prefix + Kebab(typeName);

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
