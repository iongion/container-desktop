import { describe, expect, it } from "vitest";
import { createRuntime } from "./runtime";

describe("createRuntime", () => {
  it("owns Tauri webview runtime setup such as render tuning and app origin", () => {
    const doc = document.implementation.createHTMLDocument("test");
    const runtime = createRuntime({
      appWindow: {} as any,
      documentRef: doc,
      appOrigin: "http://tauri.localhost",
    });

    runtime.tuneWebviewRendering();

    expect(runtime.appOrigin).toBe("http://tauri.localhost");
    expect(doc.querySelector("[data-tauri-font-tuning]")?.textContent).toContain("font-synthesis:none");
  });
});
