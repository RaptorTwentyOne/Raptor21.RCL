using System.Globalization;
using Raptor21.RCL.Charts.Models;

namespace Raptor21.RCL.Charts;

/// <summary>
/// Gives a chart the day and month names of a culture, in place of the charting library's own per-language
/// locale files.
/// <para>
/// The names come from <see cref="CultureInfo.DateTimeFormat"/>, so any culture .NET knows about is covered
/// without a matching chart locale file. Only blanks are filled: options that already carry
/// <c>Locales</c> are left untouched.
/// </para>
/// </summary>
public static class RaptorChartLocale
{
    /// <summary>
    /// Fills <c>chart.defaultLocale</c> and <c>chart.locales</c> from <paramref name="culture"/> unless the
    /// options already carry them. Returns the same instance for chaining.
    /// </summary>
    public static ApexChartOptions ApplyCulture(ApexChartOptions options, CultureInfo culture)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(culture);

        options.Chart ??= new Chart();

        if (options.Chart.Locales is { Count: > 0 }) return options;

        var names = culture.DateTimeFormat;

        var key = string.IsNullOrEmpty(culture.Name) ? "en" : culture.Name;

        options.Chart.DefaultLocale = key;
        options.Chart.Locales =
        [
            new ChartLocale
            {
                Name = key,
                Options = new LocaleOptions
                {
                    Months = NonEmpty(names.MonthNames),
                    ShortMonths = NonEmpty(names.AbbreviatedMonthNames),
                    Days = NonEmpty(names.DayNames),
                    ShortDays = NonEmpty(names.AbbreviatedDayNames),
                },
            },
        ];

        return options;
    }

    private static List<string> NonEmpty(string[] values) =>
        values.Where(v => !string.IsNullOrEmpty(v)).ToList();
}
