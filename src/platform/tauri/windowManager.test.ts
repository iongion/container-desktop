import { describe, expect, it, vi } from "vitest";
import { createTauriWindowManager } from "./windowManager";

function clickAnchor(href: string): { defaultPrevented: boolean } {
  document.body.innerHTML = `<a id="link" href="${href}">link</a>`;
  const link = document.getElementById("link") as HTMLAnchorElement;
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  return { defaultPrevented: event.defaultPrevented };
}

describe("createTauriWindowManager", () => {
  it("opens allowed off-origin http links externally", () => {
    const invoke = vi.fn(async () => undefined);
    const manager = createTauriWindowManager({
      appWindow: {} as any,
      invoke,
      shouldOpenExternally: () => true,
      appOrigin: "http://tauri.localhost",
      externalOpenDisabled: () => false,
    });

    manager.installExternalLinkHandler(window);

    expect(clickAnchor("https://example.com/manual").defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://example.com/manual" });
  });
});
