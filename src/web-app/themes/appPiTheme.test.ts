import { describe, expect, it } from "vitest";

import { APP_PI_THEME_TOKENS, cssColorToRgba, flattenOntoHex } from "@/web-app/themes/appPiTheme";

describe("cssColorToRgba", () => {
  it("answers in 0-255 channels, whatever colour space the webview computed the token into", () => {
    expect(cssColorToRgba("rgb(28, 33, 39)")).toEqual({ r: 28, g: 33, b: 39, a: 1 });
    // WebKitGTK computes this app's relative-colour tokens to oklch, which is the form that has to work.
    expect(cssColorToRgba("oklch(0.851628 0 256.801758)")).toMatchObject({ a: 1 });
  });

  it("clamps a colour that converts out of the sRGB gamut instead of emitting a channel over 255", () => {
    const vivid = cssColorToRgba("oklch(0.9 0.4 140)");
    expect(vivid).toBeDefined();
    for (const value of [vivid?.r, vivid?.g, vivid?.b]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }
  });

  it("refuses a keyword that is not a colour, so the host keeps its own default for that token", () => {
    expect(cssColorToRgba("inherit")).toBeUndefined();
    expect(cssColorToRgba("")).toBeUndefined();
  });
});

describe("flattenOntoHex", () => {
  it("returns an opaque colour unchanged", () => {
    expect(flattenOntoHex({ r: 20, g: 184, b: 166, a: 1 }, "#22282f")).toBe("#14b8a6");
  });

  it("composites a translucent border over the background it sits on", () => {
    expect(flattenOntoHex({ r: 255, g: 255, b: 255, a: 0.5 }, "#000000")).toBe("#808080");
  });

  it("falls back to the background when the colour is fully transparent", () => {
    expect(flattenOntoHex({ r: 255, g: 0, b: 0, a: 0 }, "#22282f")).toBe("#22282f");
  });
});

describe("APP_PI_THEME_TOKENS", () => {
  it("names one app token per pi palette entry", () => {
    expect(Object.values(APP_PI_THEME_TOKENS).every((token) => token.startsWith("--app-"))).toBe(true);
    expect(Object.keys(APP_PI_THEME_TOKENS)).toEqual([
      "chrome",
      "bg",
      "surface",
      "border",
      "text",
      "textMuted",
      "accent",
      "success",
      "warning",
      "error",
    ]);
  });
});
