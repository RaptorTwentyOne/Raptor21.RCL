/**
 * The theme's neutral chart colours — axis text and grid rules.
 *
 * Tokens are resolved to hex here because the charting library parses colour strings with its own regex,
 * which does not accept CSS Color 4's space-separated syntax: it returns null, the library indexes into
 * that null mid-render, and the chart draws its series but stops before the first axis label, with
 * nothing logged to the console.
 *
 * Read fresh on every render, never cached: the host switches theme by toggling a class at runtime, and
 * the tokens resolve to different values on each side of that switch.
 */

export interface ChartNeutrals {
    /** Axis and legend text. */
    readonly label: string;

    /** Grid rules behind the plot. */
    readonly grid: string;
}

/** Values used when the stylesheet is missing or a token resolves to something unreadable. */
const FALLBACK: ChartNeutrals = {label: '#8c9097', grid: '#f1f1f1'};

function clampByte(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map(part => clampByte(part).toString(16).padStart(2, '0')).join('');
}

/**
 * Normalises whatever a token resolves to into a hex string the charting library can parse.
 *
 * Handles the three shapes a design token realistically carries: an already-hex value, a functional
 * `rgb()`/`rgba()` in either the comma or the space-separated form, and a bare `R G B` triplet (which is
 * what a token written for `rgb(var(--x))` composition resolves to). Alpha is dropped rather than
 * composited, since the surface these are drawn on is not known here.
 */
function normalise(raw: string): string | null {
    const value = raw.trim();
    if (!value) return null;

    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
        return value;
    }

    const parts = value
        .replace(/^rgba?\(/i, '')
        .replace(/\)$/, '')
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);

    if (parts.length < 3 || parts.slice(0, 3).some(part => !Number.isFinite(part))) {
        return null;
    }

    return toHex(parts[0], parts[1], parts[2]);
}

function token(styles: CSSStyleDeclaration, name: string, fallback: string): string {
    return normalise(styles.getPropertyValue(name)) ?? fallback;
}

/** Resolves the current theme's chart neutrals from the document's custom properties. */
export function chartNeutrals(): ChartNeutrals {
    if (typeof window === 'undefined') return FALLBACK;

    const styles = getComputedStyle(document.documentElement);
    return {
        label: token(styles, '--rg-chart-label', FALLBACK.label),
        grid: token(styles, '--rg-chart-grid', FALLBACK.grid),
    };
}
