import { describe, expect, it } from "vitest";

import { visibleSidebarScreens } from "@/web-app/screenVisibility";
import type { AppScreenMetadata } from "@/web-app/Types";

const screen = (ID: string, Metadata?: Partial<AppScreenMetadata>) => ({ ID, Metadata });

describe("visibleSidebarScreens", () => {
  const screens = [screen("dashboard"), screen("hidden", { ExcludeFromSidebar: true }), screen("containers")];

  it("shows every screen except those marked ExcludeFromSidebar", () => {
    expect(visibleSidebarScreens(screens).map((s) => s.ID)).toEqual(["dashboard", "containers"]);
  });
});
