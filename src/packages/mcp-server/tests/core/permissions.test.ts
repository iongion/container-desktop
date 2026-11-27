import { describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_PERMISSION_MODE,
  isToolAllowed,
  MCP_PERMISSION_MODES,
  type McpPermissionMode,
} from "@/mcp-server/core/permissions";
import { GATED_CONTAINER_TOOLS } from "@/mcp-server/core/toolCatalogue";
import { CONTAINER_TOOL_NAMES } from "@/mcp-server/core/toolNames";

const READS = CONTAINER_TOOL_NAMES.filter((name) => !GATED_CONTAINER_TOOLS.has(name));

describe("MCP permission modes", () => {
  it("offers read-only and allow, and starts read-only", () => {
    expect(MCP_PERMISSION_MODES).toEqual(["read-only", "allow"]);
    expect(DEFAULT_MCP_PERMISSION_MODE).toBe("read-only");
  });
});

describe("isToolAllowed", () => {
  it("runs every read in either mode", () => {
    for (const mode of MCP_PERMISSION_MODES) {
      for (const name of READS) expect(isToolAllowed(mode, name)).toBe(true);
    }
  });

  it("refuses every tool that changes an engine while read-only", () => {
    for (const name of GATED_CONTAINER_TOOLS) expect(isToolAllowed("read-only", name)).toBe(false);
  });

  it("runs every tool that changes an engine once the user allows it", () => {
    for (const name of GATED_CONTAINER_TOOLS) expect(isToolAllowed("allow", name)).toBe(true);
  });

  // A mode read from a hand-edited or older settings file can be anything; only an explicit allow opens the gate.
  it("treats an unknown mode as read-only", () => {
    const unknown = "ask" as McpPermissionMode;
    expect(isToolAllowed(unknown, "removeVolume")).toBe(false);
    expect(isToolAllowed(unknown, "listVolumes")).toBe(true);
  });
});
