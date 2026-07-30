using System.Globalization;
using System.Resources;

namespace Raptor21.RCL.Localization;

/// <summary>
/// How the library resolves its own text and its number/date formats.
/// <para>
/// The UI language and the formatting culture are resolved separately, so changing the language a label is
/// written in does not change the convention numbers, dates and currency are formatted by.
/// </para>
/// </summary>
public sealed class RaptorLocalizationOptions
{
    /// <summary>
    /// Where the UI language comes from. Default: whatever <see cref="CultureInfo.CurrentUICulture"/> is at
    /// render time — which is what ASP.NET Core's request localization sets, so a host that enables it gets
    /// per-request language for free, and a host that does not gets its process default.
    /// <para>
    /// Set this to take the language from somewhere else entirely (a claim, a profile service, a header the
    /// host already parses). It is a function of the current request's services, so it can be per-request.
    /// </para>
    /// </summary>
    public Func<IServiceProvider, CultureInfo>? UiCultureResolver { get; set; }

    /// <summary>
    /// Where number, date and currency formats come from.
    /// <para>
    /// Default is <see cref="CultureInfo.InvariantCulture"/>, not the request culture, so formatting stays
    /// stable whatever the UI language is. Opt out with <see cref="UseUiCultureForFormats"/> or by setting
    /// this.
    /// </para>
    /// </summary>
    public Func<IServiceProvider, CultureInfo>? FormatCultureResolver { get; set; }

    /// <summary>
    /// Formats follow the UI culture instead of staying invariant.
    /// </summary>
    public bool UseUiCultureForFormats { get; set; }

    /// <summary>Format for whole numbers — row counts, page numbers. Default <c>N0</c>.</summary>
    public string IntegerFormat { get; set; } = "N0";

    /// <summary>Format for dates without a time. Default <c>d</c> (the culture's short date).</summary>
    public string DateFormat { get; set; } = "d";

    /// <summary>Format for dates with a time. Default <c>g</c>.</summary>
    public string DateTimeFormat { get; set; } = "g";

    /// <summary>Format for money. Default <c>C</c> — the format culture decides the symbol and placement.</summary>
    public string CurrencyFormat { get; set; } = "C";

    /// <summary>
    /// Overrides the currency the <see cref="CurrencyFormat"/> renders, independent of the format culture.
    /// A price list quoted in USD stays USD; without this, <c>C</c> would substitute the format culture's
    /// own symbol and change what the figure means rather than how it looks.
    /// </summary>
    public string? CurrencyCode { get; set; }

    /// <summary>
    /// Additional resource sets searched before the library's own. This is how a host overrides a single
    /// string ("Delete" → "Remove") without forking the library or translating everything.
    /// </summary>
    public IList<ResourceManager> AdditionalResources { get; } = new List<ResourceManager>();
}

/// <summary>
/// The library's text and formats for the current request.
/// </summary>
public interface IRaptorLocalizer
{
    /// <summary>The resolved UI language.</summary>
    CultureInfo UiCulture { get; }

    /// <summary>The resolved formatting culture.</summary>
    CultureInfo FormatCulture { get; }

    /// <summary>A translated string. Unknown keys come back as the key itself, which is visible in
    /// development rather than silently blank in production.</summary>
    string this[string key] { get; }

    /// <summary>
    /// A translated string with positional arguments.
    /// <para>
    /// A composite phrase such as "1 to 25 of 32,023" is a single resource with placeholders rather than
    /// several fragments concatenated, because word order and separators differ per language.
    /// </para>
    /// </summary>
    string Format(string key, params object?[] args);

    /// <summary>A whole number in the format culture.</summary>
    string Number(long value);

    /// <summary>A date in the format culture.</summary>
    string Date(DateTime value);

    /// <summary>A date and time in the format culture.</summary>
    string DateTime(DateTime value);

    /// <summary>Money in the format culture, honouring <see cref="RaptorLocalizationOptions.CurrencyCode"/>.</summary>
    string Currency(decimal value);
}

/// <inheritdoc />
public sealed class RaptorLocalizer : IRaptorLocalizer
{
    private static readonly ResourceManager Own = new(
        "Raptor21.RCL.Resources.RaptorText", typeof(RaptorLocalizer).Assembly);

    private readonly RaptorLocalizationOptions _options;

    public RaptorLocalizer(RaptorLocalizationOptions options, IServiceProvider services)
    {
        _options = options;

        UiCulture = options.UiCultureResolver?.Invoke(services) ?? CultureInfo.CurrentUICulture;

        FormatCulture = options.FormatCultureResolver?.Invoke(services)
                        ?? (options.UseUiCultureForFormats ? UiCulture : CultureInfo.InvariantCulture);
    }

    public CultureInfo UiCulture { get; }

    public CultureInfo FormatCulture { get; }

    public string this[string key] => Lookup(key) ?? key;

    public string Format(string key, params object?[] args)
    {
        var template = Lookup(key);

        if (template is null) return args.Length == 0 ? key : $"{key} ({string.Join(", ", args)})";

        return string.Format(FormatCulture, template, args);
    }

    public string Number(long value) => value.ToString(_options.IntegerFormat, FormatCulture);

    public string Date(DateTime value) => value.ToString(_options.DateFormat, FormatCulture);

    public string DateTime(DateTime value) => value.ToString(_options.DateTimeFormat, FormatCulture);

    public string Currency(decimal value)
    {
        if (_options.CurrencyCode is null) return value.ToString(_options.CurrencyFormat, FormatCulture);

        var format = (NumberFormatInfo)FormatCulture.NumberFormat.Clone();
        format.CurrencySymbol = _options.CurrencyCode;
        return value.ToString(_options.CurrencyFormat, format);
    }

    /// <summary>Host overrides first, then the library's own resources.</summary>
    private string? Lookup(string key)
    {
        foreach (var resources in _options.AdditionalResources)
        {
            var value = Safe(resources, key);
            if (value is not null) return value;
        }

        return Safe(Own, key);
    }

    /// <summary>
    /// Reads a key from a resource set, returning <c>null</c> instead of throwing when the set does not
    /// contain it at all — which is the normal case for a host override set.
    /// </summary>
    private string? Safe(ResourceManager resources, string key)
    {
        try
        {
            return resources.GetString(key, UiCulture);
        }
        catch (MissingManifestResourceException)
        {
            return null;
        }
    }
}
