import { describe, expect, it } from "vitest";

import { formatQueryErrorMessage } from "./queryError";

describe("formatQueryErrorMessage", () => {
  const base = "Error fetching data";

  it("appends the failing resource and the underlying error message", () => {
    const msg = formatQueryErrorMessage(base, new Error("boom"), ["registries", "system-default.podman"]);
    expect(msg).toBe("Error fetching data (registries): boom");
  });

  it("includes the detail even when the query key is unknown", () => {
    expect(formatQueryErrorMessage(base, "weird failure", undefined)).toBe("Error fetching data: weird failure");
  });

  it("falls back to the base label when there is no detail", () => {
    expect(formatQueryErrorMessage(base, new Error(""), ["images"])).toBe("Error fetching data (images)");
  });
});
