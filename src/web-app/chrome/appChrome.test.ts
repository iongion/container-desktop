import { describe, expect, it } from "vitest";

import { BOOT_CHROME_BODY, BOOT_CHROME_SCRIPT, BOOT_CHROME_STYLE, LOGO_SVG, WINDOW_CONTROLS } from "./appChrome";

// appChrome is the SINGLE SOURCE OF TRUTH for the window chrome (brand logo + window controls), shared by
// the React <AppHeader>/<AppHeaderLogo> and the static boot splash injected into index.html at build time.
// These tests lock the contract that keeps both consumers in sync — a drift here is the whole bug class this
// module exists to prevent.

describe("WINDOW_CONTROLS", () => {
  it("declares exactly the three IPC channels appControlIpc handles, in order", () => {
    expect(WINDOW_CONTROLS.map((c) => c.action)).toEqual(["window.minimize", "window.maximize", "window.close"]);
  });

  it("every control carries a label and a non-empty mdi glyph path", () => {
    for (const control of WINDOW_CONTROLS) {
      expect(control.label.length).toBeGreaterThan(0);
      expect(control.mdiPath).toMatch(/^M/); // every mdi path starts with a Move command
    }
  });
});

describe("LOGO_SVG", () => {
  it("carries the themeable classes AppHeaderLogo.css targets (so React re-themes per engine)", () => {
    for (const cls of [
      "AppHeaderLogo",
      "AppHeaderLogoPlate--deep",
      "AppHeaderLogoPlate--accent",
      "AppHeaderLogoPlate--bright",
      "AppHeaderLogoTitle",
      "AppHeaderLogoTagline--unified",
      "AppHeaderLogoTagline--podman",
      "AppHeaderLogoTagline--docker",
    ]) {
      expect(LOGO_SVG).toContain(cls);
    }
  });

  it("bakes the unified-dark brand colors as literal boot defaults (rendered before app CSS loads)", () => {
    expect(LOGO_SVG).toContain("#0d9488"); // --app-logo-deep
    expect(LOGO_SVG).toContain("#14b8a6"); // --app-logo-accent
    expect(LOGO_SVG).toContain("#2dd4bf"); // --app-logo-bright
    expect(LOGO_SVG).toContain('viewBox="0 0 940 200"');
  });
});

describe("BOOT_CHROME_BODY (generated from the shared data)", () => {
  it("embeds the single-source logo markup", () => {
    expect(BOOT_CHROME_BODY).toContain(LOGO_SVG);
  });

  it("renders one button per WINDOW_CONTROLS entry, wired to its channel and glyph", () => {
    for (const control of WINDOW_CONTROLS) {
      expect(BOOT_CHROME_BODY).toContain(`data-window-action="${control.action}"`);
      expect(BOOT_CHROME_BODY).toContain(control.mdiPath);
    }
  });

  it("includes the loading spinner", () => {
    expect(BOOT_CHROME_BODY).toContain("app-splash-ring");
  });
});

describe("BOOT_CHROME_SCRIPT", () => {
  it("wires data-window-action clicks to the same MessageBus IPC the React header uses", () => {
    expect(BOOT_CHROME_SCRIPT).toContain("data-window-action");
    expect(BOOT_CHROME_SCRIPT).toContain("MessageBus.send");
  });

  it("hides the custom controls on macOS (native traffic lights)", () => {
    expect(BOOT_CHROME_SCRIPT).toContain("data-boot-os");
  });
});

describe("BOOT_CHROME_STYLE", () => {
  it("scopes the engine tagline to unified at boot (no app CSS to hide the others)", () => {
    expect(BOOT_CHROME_STYLE).toContain("#app-boot-brand .AppHeaderLogoTagline");
  });

  it("hides the custom controls under the macOS boot flag", () => {
    expect(BOOT_CHROME_STYLE).toContain('html[data-boot-os="mac"] #app-boot-controls');
  });
});
