import { Intent } from "@blueprintjs/core";
import { describe, expect, it } from "vitest";

import { summarize } from "./summarize";

// Minimal i18next-style interpolation stub so we assert on real message text.
const t = (key: string, vars?: Record<string, unknown>) =>
  vars ? key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name])) : key;

describe("summarize", () => {
  it("reports success when every item succeeded", () => {
    const result = summarize("Stop", { ok: [1, 2, 3], failed: [] }, t);
    expect(result.intent).toBe(Intent.SUCCESS);
    expect(result.message).toBe("Stop: 3 of 3 succeeded");
  });

  it("reports a warning on partial failure", () => {
    const result = summarize("Stop", { ok: [1, 2], failed: [{ item: 3, error: new Error("x") }] }, t);
    expect(result.intent).toBe(Intent.WARNING);
    expect(result.message).toBe("Stop: 2 of 3 succeeded");
  });

  it("reports danger when every item failed", () => {
    const result = summarize(
      "Remove",
      {
        ok: [],
        failed: [
          { item: 1, error: undefined },
          { item: 2, error: undefined },
        ],
      },
      t,
    );
    expect(result.intent).toBe(Intent.DANGER);
    expect(result.message).toBe("Remove: 0 of 2 succeeded");
  });
});
