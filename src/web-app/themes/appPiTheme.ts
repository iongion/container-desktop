import type { AppThemePalette } from "@/pi-bridge/protocol";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

// The ten `--app-*` tokens a pi theme is derived from. `themes/tokens.css` re-declares these per engine
// and per light/dark mode, which is why the palette is read live rather than compiled in.
export const APP_PI_THEME_TOKENS: Record<keyof AppThemePalette, string> = {
  chrome: "--app-chrome",
  bg: "--app-bg",
  surface: "--app-surface",
  border: "--app-border",
  text: "--app-text",
  textMuted: "--app-text-muted",
  accent: "--app-accent",
  success: "--app-intent-success-rest",
  warning: "--app-intent-warning-rest",
  error: "--app-intent-danger-rest",
};

// A custom property computes to its own token stream — `var(--bp-…)`, `color-mix(…)`, `inherit` — so
// reading it off the element gives text, not a colour. Assigning it to `color` on a probe makes the
// engine resolve the whole chain, and `getComputedStyle().color` then answers in rgb.
export function readAppPiThemePalette(root?: HTMLElement): Partial<AppThemePalette> {
  const host = root ?? document.body;
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.display = "none";
  host.appendChild(probe);
  try {
    const background = flattenOntoHex(resolveToken(probe, APP_PI_THEME_TOKENS.bg) ?? OPAQUE_BLACK, "#000000");
    const palette: Partial<AppThemePalette> = {};
    for (const [key, token] of Object.entries(APP_PI_THEME_TOKENS) as [keyof AppThemePalette, string][]) {
      const resolved = resolveToken(probe, token);
      // A token that resolves to nothing is left out on purpose: the host's own fallback palette is a
      // better answer than a colour invented here.
      if (resolved) palette[key] = flattenOntoHex(resolved, background);
    }
    return palette;
  } finally {
    probe.remove();
  }
}

const OPAQUE_BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

function resolveToken(probe: HTMLElement, token: string): Rgba | undefined {
  probe.style.color = "";
  probe.style.color = `var(${token})`;
  return cssColorToRgba(getComputedStyle(probe).color);
}

export function cssColorToRgba(value: string): Rgba | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const int = Number.parseInt(hex[1], 16);
    return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff, a: 1 };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (!rgb) return undefined;
  const parts = rgb[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return undefined;
  const alpha = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
  return { r: parts[0], g: parts[1], b: parts[2], a: alpha };
}

// pi needs an opaque hex per token, but `--app-border` is a translucent hairline. Compositing it over
// the background it actually sits on keeps the colour the user sees rather than a colour nobody has.
export function flattenOntoHex(color: Rgba, background: string): string {
  if (color.a >= 1) return toHex(color.r, color.g, color.b);
  const base = cssColorToRgba(background) ?? OPAQUE_BLACK;
  const blend = (channel: number, baseChannel: number) => channel * color.a + baseChannel * (1 - color.a);
  return toHex(blend(color.r, base.r), blend(color.g, base.g), blend(color.b, base.b));
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
