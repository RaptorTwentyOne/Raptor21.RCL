using System.Collections.Frozen;
using System.Reflection;
using System.Text.Json;

namespace Raptor21.RCL.Assets;

/// <summary>
/// Resolves the client bundle out of the assembly itself.
/// <para>
/// The build output is embedded in the package rather than copied into the consuming application's
/// wwwroot, so referencing the package is all that is required to serve it.
/// </para>
/// <para>
/// Filenames are content-hashed by the client build, so nothing can hardcode them; the build also emits
/// <c>assets-manifest.json</c> mapping the stable logical name ("raptor.js") to the hashed file actually
/// present. This type reads that manifest once at startup and hands out URLs from it.
/// </para>
/// </summary>
public sealed class RaptorAssetStore
{
    private const string ResourcePrefix = "Raptor21.RCL.wwwroot.dist.";
    private const string ManifestFile = "assets-manifest.json";

    private readonly Assembly _assembly = typeof(RaptorAssetStore).Assembly;
    private readonly FrozenDictionary<string, string> _logicalToFile;
    private readonly FrozenDictionary<string, string> _fileToResource;

    public RaptorAssetStore()
    {
        _fileToResource = _assembly.GetManifestResourceNames()
            .Where(n => n.StartsWith(ResourcePrefix, StringComparison.Ordinal))
            .ToFrozenDictionary(n => n[ResourcePrefix.Length..], n => n, StringComparer.OrdinalIgnoreCase);

        _logicalToFile = ReadManifest();
    }

    /// <summary>True when the client build is present. False means the package was built without it.</summary>
    public bool HasAssets => _logicalToFile.Count > 0;

    /// <summary>Hashed filename for a logical name ("raptor.js"), or null when absent.</summary>
    public string? FileName(string logicalName) =>
        _logicalToFile.TryGetValue(logicalName, out var file) ? file : null;

    /// <summary>Opens an embedded asset by its hashed filename.</summary>
    public Stream? Open(string fileName) =>
        _fileToResource.TryGetValue(fileName, out var resource) ? _assembly.GetManifestResourceStream(resource) : null;

    public static string ContentType(string fileName) => Path.GetExtension(fileName).ToLowerInvariant() switch
    {
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".map" => "application/json; charset=utf-8",
        ".woff2" => "font/woff2",
        ".woff" => "font/woff",
        ".svg" => "image/svg+xml",
        // Raster images reach the bundle through a dependency's stylesheet — the mapping library's
        // control and marker sprites, for one — so the build emits them next to the CSS that names them.
        // Served as octet-stream they still paint in most browsers, but they fall outside the image
        // cache heuristics and a host sending X-Content-Type-Options: nosniff would refuse them.
        ".png" => "image/png",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".jpg" or ".jpeg" => "image/jpeg",
        _ => "application/octet-stream",
    };

    private FrozenDictionary<string, string> ReadManifest()
    {
        using var stream = Open(ManifestFile);
        if (stream is null) return FrozenDictionary<string, string>.Empty;

        var map = JsonSerializer.Deserialize<Dictionary<string, string>>(stream);
        return map is null
            ? FrozenDictionary<string, string>.Empty
            : map.ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);
    }
}
