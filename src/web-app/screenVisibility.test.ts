import { describe, expect, it } from "vitest";

import { aiNavScreens, visibleSidebarScreens } from "@/web-app/screenVisibility";
import type { AppScreenMetadata } from "@/web-app/Types";

const screen = (ID: string, Metadata?: Partial<AppScreenMetadata>) => ({ ID, Metadata });

// AI is always on; RequiresAI is purely a header-menu tag, never an access gate.
describe("visibleSidebarScreens", () => {
  const screens = [
    screen("dashboard"),
    screen("hidden", { ExcludeFromSidebar: true }),
    screen("ai.assistant", { RequiresAI: true }),
  ];

  it("shows every screen except those marked ExcludeFromSidebar", () => {
    expect(visibleSidebarScreens(screens).map((s) => s.ID)).toEqual(["dashboard", "ai.assistant"]);
  });
});

describe("aiNavScreens", () => {
  const screens = [
    screen("dashboard"),
    screen("ai.assistant", { RequiresAI: true }),
    screen("ai.generator", { RequiresAI: true }),
    screen("ai.diagnostics", { RequiresAI: true, ExcludeFromSidebar: true }),
  ];

  it("returns all AI screens for the header menu — even ones hidden from the sidebar", () => {
    expect(aiNavScreens(screens).map((s) => s.ID)).toEqual(["ai.assistant", "ai.generator", "ai.diagnostics"]);
  });
});
