import { describe, expect, it } from "vitest";

import { APP_PI_THEME_TOKENS, cssColorToRgba, flattenOntoHex } from "@/web-app/themes/appPiTheme";

describe("cssColorToRgba", () => {
  it("reads the rgb form a webview computes a hex token into", () => {
    expect(cssColorToRgba("rgb(28, 33, 39)")).toEqual({ r: 28, g: 33, b: 39, a: 1 });
  });

  it("reads the rgba form, keeping the alpha", () => {
    expect(cssColorToRgba("rgba(255, 255, 255, 0.16)")).toEqual({ r: 255, g: 255, b: 255, a: 0.16 });
  });

  it("reads the space-separated form with a slash alpha", () => {
    expect(cssColorToRgba("rgb(20 184 166 / 0.5)")).toEqual({ r: 20, g: 184, b: 166, a: 0.5 });
  });

  it("reads a hex the browser passed through untouched", () => {
    expect(cssColorToRgba("#14b8a6")).toEqual({ r: 20, g: 184, b: 166, a: 1 });
  });

  it("refuses a keyword it cannot resolve to channels", () => {
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
