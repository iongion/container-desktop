import { describe, expect, it } from "vitest";
import { DEFAULT_MCP_PORT, MCP_SETTINGS_KEY, normalizeMcpSettings } from "@/container-client/mcpSettings";

describe("normalizeMcpSettings", () => {
  it("is off, read-only and on the default port when nothing is stored", () => {
    const expected = { enabled: false, port: DEFAULT_MCP_PORT, mode: "read-only" };
    expect(normalizeMcpSettings(undefined)).toEqual(expected);
    expect(normalizeMcpSettings(null)).toEqual(expected);
    expect(normalizeMcpSettings({})).toEqual(expected);
    expect(normalizeMcpSettings("on")).toEqual(expected);
    expect(normalizeMcpSettings([true])).toEqual(expected);
  });

  it("is stored under the `mcp` key", () => {
    expect(MCP_SETTINGS_KEY).toBe("mcp");
  });

  it("defaults to a fixed port clear of the dev servers and local tools this project runs beside", () => {
    // Vite, Tauri's dev port, LM Studio, the Node inspector, Ollama, and the MCP Inspector's UI and proxy.
    expect([3000, 1420, 1234, 9099, 9229, 11434, 6274, 6277]).not.toContain(DEFAULT_MCP_PORT);
    // Below the Linux (32768+) and Windows (49152+) ephemeral ranges and Kubernetes' NodePorts (30000-32767), so an
    // outgoing connection or a published service never holds it first.
    expect(DEFAULT_MCP_PORT).toBeGreaterThanOrEqual(1024);
    expect(DEFAULT_MCP_PORT).toBeLessThan(30000);
  });

  it("keeps a stored choice", () => {
    expect(normalizeMcpSettings({ enabled: true, port: 18080, mode: "allow" })).toEqual({
      enabled: true,
      port: 18080,
      mode: "allow",
    });
  });

  it("enables only on an explicit true", () => {
    expect(normalizeMcpSettings({ enabled: "true" }).enabled).toBe(false);
    expect(normalizeMcpSettings({ enabled: 1 }).enabled).toBe(false);
    expect(normalizeMcpSettings({ enabled: true }).enabled).toBe(true);
  });

  it("allows changes only on an explicit allow, so any other mode stays read-only", () => {
    expect(normalizeMcpSettings({ mode: "ask" }).mode).toBe("read-only");
    expect(normalizeMcpSettings({ mode: "ALLOW" }).mode).toBe("read-only");
    expect(normalizeMcpSettings({ mode: "read-only" }).mode).toBe("read-only");
  });

  it("takes a port typed as text", () => {
    expect(normalizeMcpSettings({ port: "18080" }).port).toBe(18080);
    expect(normalizeMcpSettings({ port: " 18080 " }).port).toBe(18080);
  });

  it("falls back to the default port for one out of range or not a whole number", () => {
    for (const port of [0, 80, 1023, 65536, -1, 18080.5, Number.NaN, "", "18080x", "0x4000", true, {}]) {
      expect(normalizeMcpSettings({ port }).port, `port ${String(port)}`).toBe(DEFAULT_MCP_PORT);
    }
    expect(normalizeMcpSettings({ port: 1024 }).port).toBe(1024);
    expect(normalizeMcpSettings({ port: 65535 }).port).toBe(65535);
  });
});
