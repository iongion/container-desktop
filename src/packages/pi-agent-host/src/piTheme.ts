import { Theme } from "@earendil-works/pi-coding-agent";

import type { AppThemePalette } from "@/pi-bridge/protocol";

// pi's own constructor is the single origin for which colour keys exist: naming them again here would
// drift the day pi adds one, and the compiler would not notice.
type PiThemeForeground = ConstructorParameters<typeof Theme>[0];
type PiThemeBackground = ConstructorParameters<typeof Theme>[1];

export interface PiThemeColors {
  fg: PiThemeForeground;
  bg: PiThemeBackground;
}

// The app's own dark defaults from `themes/tokens.css`, used only where the renderer sent something
// pi cannot read as a colour — `--app-text` resolves to `inherit`, a `color-mix()` that did not
// compute. pi throws on a non-hex value, and one odd token must not cost the session its theme.
const FALLBACK_PALETTE: AppThemePalette = {
  chrome: "#1c2127",
  bg: "#1c2127",
  surface: "#1c2127",
  border: "#404854",
  text: "#e5e8eb",
  textMuted: "#8a93a0",
  accent: "#2d72d2",
  success: "#238551",
  warning: "#c87619",
  error: "#cd4246",
};

export function normalizeAppThemePalette(palette: Partial<AppThemePalette> | undefined): AppThemePalette {
  const normalized = { ...FALLBACK_PALETTE };
  for (const key of Object.keys(FALLBACK_PALETTE) as (keyof AppThemePalette)[]) {
    const value = palette?.[key];
    if (typeof value === "string" && isHexColor(value)) normalized[key] = value.trim().toLowerCase();
  }
  return normalized;
}

// Every pi colour traces back to one of the ten app tokens. Nothing is invented: where pi wants more
// separation than the palette carries, the extra shades are blends of two tokens, so plugin output
// still reads as the same theme the rest of the app is painted in.
export function buildPiThemeColors(input: AppThemePalette): PiThemeColors {
  const palette = normalizeAppThemePalette(input);
  const { bg, surface, chrome, border, text, textMuted, accent, success, warning, error } = palette;
  const dim = mixHexColors(textMuted, bg, 0.45);
  const accentSoft = mixHexColors(accent, text, 0.45);

  return {
    fg: {
      accent,
      border,
      borderAccent: accent,
      borderMuted: mixHexColors(border, bg, 0.5),
      success,
      error,
      warning,
      muted: textMuted,
      dim,
      text,
      thinkingText: textMuted,
      userMessageText: text,
      customMessageText: text,
      customMessageLabel: accent,
      toolTitle: accent,
      toolOutput: text,

      mdHeading: accent,
      mdLink: accent,
      mdLinkUrl: textMuted,
      mdCode: accentSoft,
      mdCodeBlock: text,
      mdCodeBlockBorder: border,
      mdQuote: textMuted,
      mdQuoteBorder: border,
      mdHr: border,
      mdListBullet: accent,

      toolDiffAdded: success,
      toolDiffRemoved: error,
      toolDiffContext: textMuted,

      syntaxComment: dim,
      syntaxKeyword: accent,
      syntaxFunction: accentSoft,
      syntaxVariable: text,
      syntaxString: success,
      syntaxNumber: warning,
      syntaxType: mixHexColors(accent, warning, 0.5),
      syntaxOperator: textMuted,
      syntaxPunctuation: textMuted,

      thinkingOff: dim,
      thinkingMinimal: textMuted,
      thinkingLow: mixHexColors(textMuted, accent, 0.5),
      thinkingMedium: accent,
      thinkingHigh: mixHexColors(accent, warning, 0.5),
      thinkingXhigh: warning,
      thinkingMax: error,

      bashMode: warning,
    },
    // No `scrollbarThumb`: pi's published types predate it and fall back to `selectedBg`, and the GUI
    // paints components as line frames — there is no fullscreen viewport to scroll.
    bg: {
      selectedBg: mixHexColors(surface, accent, 0.18),
      userMessageBg: chrome,
      customMessageBg: mixHexColors(surface, accent, 0.1),
      toolPendingBg: surface,
      toolSuccessBg: mixHexColors(bg, success, 0.12),
      toolErrorBg: mixHexColors(bg, error, 0.12),
    },
  };
}

// Truecolor: the surfaces are painted by xterm in a webview, which has no 256-colour limit, so
// quantising would only lose fidelity the renderer can display.
export function buildPiTheme(palette: AppThemePalette): Theme {
  const { fg, bg } = buildPiThemeColors(palette);
  return new Theme(fg, bg, "truecolor", { name: "container-desktop" });
}

// Where pi keeps THE theme its own components read. It is an exported Proxy over these globals, resolved on every
// property access, and the keys are `Symbol.for` registry symbols precisely so separate copies of pi's module —
// loaded through tsx here and jiti for plugins — share one theme. That registry is the handshake, so writing it is
// how the app's palette reaches pi's Markdown, SelectList and Editor; `setThemeInstance`, which does exactly this,
// is in pi's theme module but outside the package's `exports` map, and so is the proxy itself.
//
// BOTH keys, as pi's own writer does: a component loaded under the former package identity reads the other one, and
// writing one would leave half the surfaces on the old palette. If pi ever renames them, plugin components simply
// paint in pi's built-in theme again — the same place they were before this existed, and nothing throws.
const PI_THEME_KEYS = [
  Symbol.for("@earendil-works/pi-coding-agent:theme"),
  Symbol.for("@mariozechner/pi-coding-agent:theme"),
];

export function installGlobalPiTheme(theme: Theme): void {
  const globals = globalThis as Record<symbol, unknown>;
  for (const key of PI_THEME_KEYS) globals[key] = theme;
}

// Blends two `#rrggbb` values. A token the renderer could not resolve (a stray `inherit`, a var that
// never landed) keeps the first colour rather than throwing the whole theme away.
export function mixHexColors(from: string, to: string, ratio: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a) return from;
  if (!b) return `#${toHexPair(a[0])}${toHexPair(a[1])}${toHexPair(a[2])}`;
  const t = Math.min(1, Math.max(0, ratio));
  const channels = a.map((value, index) => Math.round(value + (b[index] - value) * t));
  return `#${channels.map(toHexPair).join("")}`;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

function parseHex(value: string): [number, number, number] | undefined {
  if (!isHexColor(value)) return undefined;
  const int = Number.parseInt(value.trim().slice(1), 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

function toHexPair(value: number): string {
  return Math.min(255, Math.max(0, value)).toString(16).padStart(2, "0");
}
