import { describe, expect, it } from "vitest";
import { ACCESS_PROFILES, accessProfileTools, DEFAULT_ACCESS_PROFILE } from "./accessProfiles";
import { WORKER_TOOL_CATALOGUE } from "./workerTools";

describe("Assistant access profiles", () => {
  it("defaults to the existing complete first-party tool surface", () => {
    expect(DEFAULT_ACCESS_PROFILE).toBe("operator");
    expect(accessProfileTools(DEFAULT_ACCESS_PROFILE)).toEqual(new Set(WORKER_TOOL_CATALOGUE.map(({ name }) => name)));
  });

  it("keeps observe read-only across every tool group", () => {
    const allowed = accessProfileTools("observe");
    expect(WORKER_TOOL_CATALOGUE.filter(({ gated }) => gated).every(({ name }) => !allowed.has(name))).toBe(true);
    expect(WORKER_TOOL_CATALOGUE.filter(({ gated }) => !gated).every(({ name }) => allowed.has(name))).toBe(true);
  });

  it("lets workspace edit files without exposing container mutations", () => {
    const allowed = accessProfileTools("workspace");
    expect(allowed.has("writeFile")).toBe(true);
    expect(allowed.has("execCommand")).toBe(true);
    expect(allowed.has("removeContainer")).toBe(false);
    expect(allowed.has("listContainers")).toBe(true);
  });

  it("declares stable labels and descriptions for every profile", () => {
    expect(ACCESS_PROFILES.map(({ id }) => id)).toEqual(["observe", "workspace", "operator"]);
    expect(ACCESS_PROFILES.every(({ labelKey, descriptionKey }) => labelKey && descriptionKey)).toBe(true);
  });
});
