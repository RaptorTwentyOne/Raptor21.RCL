// Ported from apexcharts/Blazor-ApexCharts (https://github.com/apexcharts/Blazor-ApexCharts)
// Copyright (c) 2020 Joakim Dangården. Licensed under the MIT License.
//
// Adapted for Raptor21: namespace changed, Blazor component/JS-interop members removed. The option
// model itself is unchanged so callers can follow the upstream ApexCharts documentation directly.

#nullable disable

using System.Text.RegularExpressions;

namespace Raptor21.RCL.Charts.Serialization;

/// <summary>
/// Provides JavaScript related helper utilities for ApexCharts internal processing.
/// </summary>
internal static class ChartUtilities
{
    /// <summary>
    /// Regex that matches the beginning of a JavaScript function or arrow function (including optional leading comments).
    /// </summary>
    private static readonly Regex JsFunctionStartRegex = new(
        @"^\s*(?:/\*[\s\S]*?\*/\s*|//[^\n]*\n\s*)*(?:async\s+)?(?:
              function\b
            | \([^)]*\)\s*=>          # (args) =>
            | [A-Za-z_$][\w$]*\s*=>   # identifier =>
        )",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnorePatternWhitespace);

    /// <summary>
    /// Regex that matches immediately-invoked function expressions (IIFE) using the traditional function keyword.
    /// </summary>
    private static readonly Regex IifeFunctionRegex = new(
        @"^\s*\(\s*(?:async\s+)?function\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// Regex that matches immediately-invoked arrow function expressions.
    /// </summary>
    private static readonly Regex IifeArrowRegex = new(
        @"^\s*\(\s*(?:async\s+)?\([^)]*\)\s*=>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// Determines whether the provided string appears to represent a JavaScript function
    /// (standard function declaration, arrow function, or IIFE).
    /// </summary>
    /// <param name="candidate">The string to inspect.</param>
    /// <returns>
    /// <see langword="true"/> if the string structurally resembles a JavaScript function;
    /// otherwise, <see langword="false"/>.
    /// </returns>
    internal static bool IsJavaScriptFunction(string candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
            return false;

        if (!(candidate.Contains("function", StringComparison.OrdinalIgnoreCase) ||
              candidate.Contains("=>", StringComparison.Ordinal)))
            return false;

        if (JsFunctionStartRegex.IsMatch(candidate))
            return true;

        if (IifeFunctionRegex.IsMatch(candidate) || IifeArrowRegex.IsMatch(candidate))
            return true;

        return false;
    }
}