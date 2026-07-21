import { describe, expect, it } from "vitest";

import { isExternalHttpLink } from "./linkPolicy";

// The app origin under Tauri on Linux/Windows (the WebKitGTK/WebView2 custom http scheme).
const APP = "http://tauri.localhost";

describe("isExternalHttpLink", () => {
  it("treats a same-origin hash route as in-app, NOT external (the Phase D sidebar regression)", () => {
    // Navigator.pathTo emits `${origin}/#/…` when not on file:// — these must reach the router, not the browser.
    expect(isExternalHttpLink(`${APP}/#/screens/containers`, APP)).toBe(false);
    expect(isExternalHttpLink(`${APP}/#/screens/images`, APP)).toBe(false);
    expect(isExternalHttpLink(`${APP}/#/screens/settings/user-settings?category=config`, APP)).toBe(false);
  });

  it("treats a cross-origin http(s) link as external (→ OS browser)", () => {
    expect(isExternalHttpLink("https://container-desktop.com/docs", APP)).toBe(true);
    expect(isExternalHttpLink("http://192.168.1.10:9000/", APP)).toBe(true);
    expect(isExternalHttpLink("https://github.com/iongion/container-desktop", APP)).toBe(true);
  });

  it("ignores non-http links (file / mailto / blob / empty)", () => {
    expect(isExternalHttpLink("file:///app/index.html#/screens/containers", APP)).toBe(false);
    expect(isExternalHttpLink("mailto:someone@example.com", APP)).toBe(false);
    expect(isExternalHttpLink("blob:http://tauri.localhost/abc", APP)).toBe(false);
    expect(isExternalHttpLink("", APP)).toBe(false);
  });

  it("under Electron's file:// origin, same-document hash links stay in-app", () => {
    expect(isExternalHttpLink("file:///home/u/app/index.html#/screens/images", "file://")).toBe(false);
  });
});
