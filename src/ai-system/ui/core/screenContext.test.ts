import { describe, expect, it } from "vitest";

import { buildScreenContext } from "./screenContext";

describe("buildScreenContext", () => {
  it("returns empty when no screen is known", () => {
    expect(buildScreenContext({})).toBe("");
    expect(buildScreenContext({ id: undefined, title: undefined })).toBe("");
  });

  it("names the active screen by title and id", () => {
    const out = buildScreenContext({ id: "containers", title: "Containers" });
    expect(out.toLowerCase()).toContain("viewing");
    expect(out).toContain("Containers");
    expect(out).toContain("containers");
  });

  it("falls back to the id when the title is absent", () => {
    const out = buildScreenContext({ id: "swarm" });
    expect(out).toContain("swarm");
  });

  it("appends focus guidance and on-screen detail when provided", () => {
    const out = buildScreenContext({
      id: "image.security",
      title: "Image Security",
      focus: "Help the user audit image vulnerabilities and signatures.",
      detail: "On screen: nginx:latest — 3 critical CVEs.",
    });
    expect(out).toContain("Image Security");
    expect(out).toContain("Help the user audit image vulnerabilities and signatures.");
    expect(out).toContain("On screen: nginx:latest — 3 critical CVEs.");
    // focus/detail come after the screen line
    expect(out.indexOf("Image Security")).toBeLessThan(out.indexOf("audit image vulnerabilities"));
  });

  it("omits focus/detail lines that are blank", () => {
    const out = buildScreenContext({ id: "pods", title: "Pods", focus: "  ", detail: "" });
    expect(out.split("\n")).toHaveLength(1);
  });
});
