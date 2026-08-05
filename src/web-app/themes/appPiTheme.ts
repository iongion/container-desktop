import { converter, parse } from "culori";

import type { AppThemePalette } from "@/pi-bridge/protocol";

const toSrgb = (value: string) => {
  const parsed = parse(value);
  return parsed ? converter("rgb")(parsed) : undefined;
};

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
  // Rendered but invisible, NOT `display: none`: WebKit does not resolve a colour for an element that is
  // not in the layout tree, so a hidden probe answers with nothing and the whole palette comes back empty.
  probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none";
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

// Parsing is culori's job, not ours. This app's themes are built from relative colours
// (`oklch(from #4b5563 …)`) and WebKitGTK computes them to `oklch()`, so reading its own tokens would
// otherwise mean reimplementing colour science — culori handles oklch, `color(srgb …)`, lab, hsl, hex,
// rgb/rgba and named colours, and converts them all to sRGB with no DOM involved.
export function cssColorToRgba(value: string): Rgba | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const parsed = toSrgb(text);
  if (!parsed) return undefined;
  return {
    r: channel(parsed.r),
    g: channel(parsed.g),
    b: channel(parsed.b),
    a: parsed.alpha ?? 1,
  };
}

// culori works in 0..1 channels and does not clamp an out-of-gamut conversion, which oklch produces
// readily; a CSS colour is 0..255 bytes.
function channel(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
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
