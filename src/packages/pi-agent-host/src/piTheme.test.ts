import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  buildPiTheme,
  buildPiThemeColors,
  installGlobalPiTheme,
  mixHexColors,
  normalizeAppThemePalette,
} from "@/pi-agent-host/piTheme";
import type { AppThemePalette } from "@/pi-bridge/protocol";

const palette: AppThemePalette = {
  chrome: "#1b2027",
  bg: "#22282f",
  surface: "#2a313a",
  border: "#39424d",
  text: "#e8edf2",
  textMuted: "#9aa5b1",
  accent: "#14b8a6",
  success: "#2ea043",
  warning: "#d29922",
  error: "#f85149",
};

describe("mixHexColors", () => {
  it("returns the first colour at ratio zero and the second at one", () => {
    expect(mixHexColors("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHexColors("#000000", "#ffffff", 1)).toBe("#ffffff");
  });

  it("blends channel by channel", () => {
    expect(mixHexColors("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHexColors("#14b8a6", "#22282f", 0.5)).toBe("#1b706b");
  });

  it("falls back to the first colour when a value is not a hex triplet", () => {
    expect(mixHexColors("#14b8a6", "inherit", 0.5)).toBe("#14b8a6");
  });
});

describe("buildPiThemeColors", () => {
  it("maps accent, success, warning and error onto the pi colour names", () => {
    const { fg } = buildPiThemeColors(palette);
    expect(fg.accent).toBe("#14b8a6");
    expect(fg.success).toBe("#2ea043");
    expect(fg.warning).toBe("#d29922");
    expect(fg.error).toBe("#f85149");
  });

  it("maps muted from the muted token rather than inventing a grey", () => {
    const { fg } = buildPiThemeColors(palette);
    expect(fg.muted).toBe("#9aa5b1");
    expect(fg.dim).toBe(mixHexColors(palette.textMuted, palette.bg, 0.45));
  });

  it("keeps text on the app's own text colour instead of the terminal default", () => {
    const { fg } = buildPiThemeColors(palette);
    expect(fg.text).toBe("#e8edf2");
    expect(fg.toolOutput).toBe("#e8edf2");
  });

  it("derives the diff and markdown colours from the palette's semantics", () => {
    const { fg } = buildPiThemeColors(palette);
    expect(fg.toolDiffAdded).toBe("#2ea043");
    expect(fg.toolDiffRemoved).toBe("#f85149");
    expect(fg.mdHeading).toBe("#14b8a6");
    expect(fg.mdQuoteBorder).toBe("#39424d");
  });

  it("derives every background from a surface token", () => {
    const { bg } = buildPiThemeColors(palette);
    expect(bg.userMessageBg).toBe("#1b2027");
    expect(bg.toolPendingBg).toBe("#2a313a");
    expect(bg.toolErrorBg).toBe(mixHexColors(palette.bg, palette.error, 0.12));
  });

  it("ramps the thinking levels from muted through accent to error", () => {
    const { fg } = buildPiThemeColors(palette);
    expect(fg.thinkingMinimal).toBe("#9aa5b1");
    expect(fg.thinkingMedium).toBe("#14b8a6");
    expect(fg.thinkingMax).toBe("#f85149");
  });

  it("defines every colour key pi's theme schema requires", () => {
    const { fg, bg } = buildPiThemeColors(palette);
    for (const [key, value] of Object.entries({ ...fg, ...bg })) {
      expect(value, `colour ${key} must be derived, not empty`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect(Object.keys(fg)).toHaveLength(46);
    expect(Object.keys(bg)).toHaveLength(6);
  });
});

describe("normalizeAppThemePalette", () => {
  it("keeps every hex the renderer resolved", () => {
    expect(normalizeAppThemePalette(palette)).toEqual(palette);
  });

  it("replaces a token that is not a hex with the app's own dark default", () => {
    const normalized = normalizeAppThemePalette({ ...palette, text: "inherit", border: "rgba(0,0,0,0.16)" });
    expect(normalized.text).toBe("#e5e8eb");
    expect(normalized.border).toBe("#404854");
    expect(normalized.accent).toBe("#14b8a6");
  });

  it("answers with a complete palette when the renderer sent nothing at all", () => {
    expect(Object.values(normalizeAppThemePalette(undefined)).every((value) => /^#[0-9a-f]{6}$/.test(value))).toBe(
      true,
    );
  });
});

describe("buildPiTheme", () => {
  it("builds a real pi Theme that emits truecolor ANSI for the app's accent", () => {
    const styled = buildPiTheme(palette).fg("accent", "hello");
    expect(styled).toBe("\x1b[38;2;20;184;166mhello\x1b[39m");
  });

  it("styles a background from the derived surface", () => {
    expect(buildPiTheme(palette).bg("toolPendingBg", "x")).toContain("\x1b[48;2;42;49;58m");
  });

  it("names itself so a plugin listing themes sees the app's own", () => {
    expect(buildPiTheme(palette).name).toBe("container-desktop");
  });

  it("survives a palette token the renderer could not resolve to a hex", () => {
    const theme = buildPiTheme({ ...palette, text: "inherit" });
    expect(theme.fg("text", "x")).toContain("x");
  });
});

// pi's own components read a module-global theme through an exported Proxy, on every property access. The global
// lives under a `Symbol.for` registry key precisely so separate copies of the module (tsx, jiti) share one theme,
// which is what makes it reachable — and what makes installing the app's theme there the difference between a
// plugin's Markdown painting in pi's built-in dark and painting in the app's own colours.
describe("installGlobalPiTheme", () => {
  // Asserted through pi's OWN public markdown theme, whose closures resolve that proxy on every call — so this
  // is the same route a plugin's Markdown component takes, not a copy of it.
  it("makes pi's own markdown theme paint in the app's colours", () => {
    const theme = buildPiTheme(palette);
    installGlobalPiTheme(theme);
    expect(getMarkdownTheme().heading("Title")).toBe(theme.fg("mdHeading", "Title"));
    expect(getMarkdownTheme().listBullet("-")).toBe(theme.fg("mdListBullet", "-"));
  });

  it("replaces the installed theme when the app changes engine or mode", () => {
    installGlobalPiTheme(buildPiTheme(palette));
    const teal = getMarkdownTheme().heading("Title");
    const blue = buildPiTheme({ ...palette, accent: "#2d72d2" });
    installGlobalPiTheme(blue);
    expect(getMarkdownTheme().heading("Title")).toBe(blue.fg("mdHeading", "Title"));
    expect(getMarkdownTheme().heading("Title")).not.toBe(teal);
  });

  // pi writes both its current and its former package key, so a component loaded from either module identity
  // sees the same theme. Writing only one is how half the surfaces would keep the old palette.
  it("installs under both of the keys pi itself writes", () => {
    const theme = buildPiTheme(palette);
    installGlobalPiTheme(theme);
    const globals = globalThis as Record<symbol, unknown>;
    expect(globals[Symbol.for("@earendil-works/pi-coding-agent:theme")]).toBe(theme);
    expect(globals[Symbol.for("@mariozechner/pi-coding-agent:theme")]).toBe(theme);
  });
});
