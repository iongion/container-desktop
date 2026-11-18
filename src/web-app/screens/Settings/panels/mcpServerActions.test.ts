import { describe, expect, it } from "vitest";

import type { McpSettings } from "@/container-client/mcpSettings";
import { MCP_CHANNELS, type McpStatus } from "@/platform/mcpIpc";
import {
  applyMcpSettings,
  loadMcpServer,
  type McpServerDeps,
} from "@/web-app/screens/Settings/panels/mcpServerActions";

const LISTENING: McpStatus = { running: true, port: 17627, url: "http://127.0.0.1:17627/mcp", mode: "read-only" };
const TOKEN = "ab".repeat(32);
const ON: McpSettings = { enabled: true, port: 17627, mode: "read-only" };

// Records every call in order and answers each channel from `answers` (a function throws to reject).
function fakeDeps(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const deps: McpServerDeps = {
    invoke: async (channel, payload) => {
      calls.push(payload === undefined ? channel : `${channel} ${JSON.stringify(payload)}`);
      const answer = answers[channel];
      if (typeof answer === "function") return answer();
      return answer;
    },
    saveSettings: async (settings) => {
      calls.push(`save ${JSON.stringify(settings)}`);
    },
  };
  return { deps, calls };
}

describe("mcpServerActions", () => {
  it("saves the settings before applying them, then reads the token of the running server", async () => {
    const { deps, calls } = fakeDeps({ [MCP_CHANNELS.apply]: LISTENING, [MCP_CHANNELS.token]: TOKEN });
    const view = await applyMcpSettings(ON, deps);
    expect(view).toEqual({ status: LISTENING, token: TOKEN });
    expect(calls).toEqual([
      `save ${JSON.stringify(ON)}`,
      `${MCP_CHANNELS.apply} ${JSON.stringify({ settings: ON })}`,
      MCP_CHANNELS.token,
    ]);
  });

  it("never asks for a token while the server is off, since asking creates one", async () => {
    const stopped: McpStatus = { running: false };
    const { deps, calls } = fakeDeps({ [MCP_CHANNELS.apply]: stopped, [MCP_CHANNELS.status]: stopped });
    expect(await applyMcpSettings({ ...ON, enabled: false }, deps)).toEqual({ status: stopped, token: "" });
    expect(await loadMcpServer(deps)).toEqual({ status: stopped, token: "" });
    expect(calls).not.toContain(MCP_CHANNELS.token);
  });

  it("keeps the status of a server that failed to start, with no token", async () => {
    const failed: McpStatus = { running: false, error: "The MCP server could not listen on 127.0.0.1:17627" };
    const { deps } = fakeDeps({ [MCP_CHANNELS.apply]: failed });
    expect(await applyMcpSettings(ON, deps)).toEqual({ status: failed, token: "" });
  });

  it("shows a running server without its token when the token cannot be read", async () => {
    const { deps } = fakeDeps({
      [MCP_CHANNELS.status]: LISTENING,
      [MCP_CHANNELS.token]: () => {
        throw new Error("keychain locked");
      },
    });
    expect(await loadMcpServer(deps)).toEqual({ status: LISTENING, token: "" });
  });
});
