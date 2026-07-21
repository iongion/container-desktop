import { describe, expect, it } from "vitest";
import { CONTAINER_TOOL_NAMES, getContainerToolPresentation } from "@/ai-system/core/toolNames";
import { toolTitle } from "./toolTitle";

const t = (key: string, options?: Record<string, unknown>): string =>
  key.replace(/{{(\w+)}}/g, (_, name: string) => String(options?.[name] ?? ""));

describe("toolTitle", () => {
  it("loads presentation metadata for every typed container tool", () => {
    expect(CONTAINER_TOOL_NAMES.every((name) => getContainerToolPresentation(name))).toBe(true);
  });

  it("derives a localized container title from tool name and arguments", () => {
    expect(toolTitle("inspectContainer", { id: "abcdef123456789" }, t)).toBe("Inspect container abcdef123456");
  });

  it("identifies the target connection for mutations", () => {
    expect(toolTitle("stopContainer", { id: "web", connectionId: "docker-remote" }, t)).toBe(
      "Stop container web (docker-remote)",
    );
  });

  it("keeps the supplied fallback for unknown tools", () => {
    expect(toolTitle("extensionTool", {}, t, "Extension tool")).toBe("Extension tool");
  });
});
