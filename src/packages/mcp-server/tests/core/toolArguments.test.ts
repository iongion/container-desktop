import { describe, expect, it } from "vitest";
import { validateToolArguments } from "@/mcp-server/core/toolArguments";

describe("validateToolArguments", () => {
  it("accepts arguments that match the tool's schema", () => {
    expect(validateToolArguments("inspectContainer", { id: "web" })).toBeUndefined();
    expect(
      validateToolArguments("getContainerLogs", { id: "web", tail: 5000, connectionId: "podman" }),
    ).toBeUndefined();
    expect(validateToolArguments("listConnections", {})).toBeUndefined();
  });

  it("names a missing required argument", () => {
    expect(validateToolArguments("stopContainer", {})).toBe("arguments must have required property 'id'");
  });

  it("refuses an empty id", () => {
    expect(validateToolArguments("removeImage", { id: "" })).toMatch(/^arguments\/id /);
  });

  it("refuses a log tail above 5000 lines, or one that is not a whole number", () => {
    expect(validateToolArguments("getContainerLogs", { id: "web", tail: 5001 })).toBe("arguments/tail must be <= 5000");
    expect(validateToolArguments("getContainerLogs", { id: "web", tail: 2.5 })).toBe("arguments/tail must be integer");
  });

  it("names an undeclared argument, so the caller can drop it", () => {
    expect(validateToolArguments("removeContainer", { id: "web", force: true })).toBe(
      "arguments must NOT have additional properties (force)",
    );
    expect(validateToolArguments("listConnections", { connectionId: "podman" })).toBe(
      "arguments must NOT have additional properties (connectionId)",
    );
  });

  it("refuses an argument of the wrong type", () => {
    expect(validateToolArguments("pullImage", { reference: 42 })).toBe("arguments/reference must be string");
  });
});
