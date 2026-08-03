import { describe, expect, it } from "vitest";

import { getAppThemeEpoch, subscribeAppThemeEpoch } from "@/web-app/themes/appThemeEpoch";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("subscribeAppThemeEpoch", () => {
  it("advances the epoch when the theme attribute changes", async () => {
    const seen: number[] = [];
    const unsubscribe = subscribeAppThemeEpoch(() => seen.push(getAppThemeEpoch()));
    document.documentElement.setAttribute("data-theme", "light");
    await settle();
    expect(seen).toHaveLength(1);
    unsubscribe();
  });

  it("advances it when the engine changes, because the tokens differ per engine", async () => {
    let calls = 0;
    const unsubscribe = subscribeAppThemeEpoch(() => {
      calls += 1;
    });
    document.body.setAttribute("data-engine", "podman");
    await settle();
    expect(calls).toBeGreaterThan(0);
    unsubscribe();
  });

  it("stops observing once the last subscriber leaves", async () => {
    let calls = 0;
    const unsubscribe = subscribeAppThemeEpoch(() => {
      calls += 1;
    });
    unsubscribe();
    document.documentElement.setAttribute("data-theme", "dark");
    await settle();
    expect(calls).toBe(0);
  });

  it("reports a number that only ever grows", async () => {
    const before = getAppThemeEpoch();
    const unsubscribe = subscribeAppThemeEpoch(() => {});
    document.documentElement.setAttribute("data-theme", "podman-dark");
    await settle();
    expect(getAppThemeEpoch()).toBeGreaterThan(before);
    unsubscribe();
  });
});
