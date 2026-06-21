import { describe, expect, it, vi } from "vitest";

import type { CachedVerdict } from "@/ai-system/core";
import { createAgentTools, runCommandInput, runCommandTool, searchKnowledgeTool, webSearchTool } from "./tools";

const okExec = vi.fn(async () => ({
  ok: true,
  tier: "ran" as const,
  reason: "",
  stdout: "out",
  stderr: "",
  code: 0,
  truncated: false,
}));

function deps(over: Partial<Parameters<typeof createAgentTools>[0]> = {}) {
  return {
    runSandboxed: okExec,
    searchKnowledge: vi.fn(async () => []),
    mode: "ask" as const,
    ...over,
  };
}

const cache =
  (...entries: Array<[string, CachedVerdict]>) =>
  (key: string): CachedVerdict =>
    entries.find(([k]) => k === key)?.[1];

describe("runCommandInput — the model can set ONLY {program, args}", () => {
  it("accepts a bare {program, args}", () => {
    expect(runCommandInput.safeParse({ program: "podman", args: ["ps"] }).success).toBe(true);
    expect(runCommandInput.safeParse({ program: "podman" }).success).toBe(true); // args optional → []
  });

  it("REJECTS any process option smuggled alongside program/args", () => {
    for (const extra of [
      { shell: true },
      { cwd: "/" },
      { env: {} },
      { detached: true },
      { wrapper: {} },
      { timeout: 1 },
    ]) {
      expect(runCommandInput.safeParse({ program: "podman", args: ["ps"], ...extra }).success).toBe(false);
    }
  });
});

describe("runCommandTool — permission gating (resolveToolAction)", () => {
  it("ask mode: asks for ANY command and ignores the cache", async () => {
    const events: any[] = [];
    // Even a command cached as "allow" must still prompt in ask mode (the cache is ignored).
    const d = deps({
      onEvent: (e: any) => events.push(e),
      cacheLookup: cache([JSON.stringify(["podman", ["ps"]]), "allow"]),
    });
    const res = await runCommandTool(d, { program: "podman", args: ["ps"] });
    expect(d.runSandboxed).not.toHaveBeenCalled();
    expect(res.awaitingApproval).toBe(true);
    expect(events.some((e) => e.type === "approval-request")).toBe(true);
  });

  it("ask mode: rejects a floor-blocked command without running it", async () => {
    const events: any[] = [];
    const d = deps({ onEvent: (e: any) => events.push(e) });
    const res = await runCommandTool(d, { program: "rm", args: ["-rf", "/"] });
    expect(d.runSandboxed).not.toHaveBeenCalled();
    expect(res.rejected).toBe(true);
    expect(events.some((e) => e.type === "rejected")).toBe(true);
  });

  it("remember mode: runs a cached-allow command through the sandbox (floor enforced)", async () => {
    const d = deps({ mode: "remember", cacheLookup: cache([JSON.stringify(["podman", ["ps"]]), "allow"]) });
    const res = await runCommandTool(d, { program: "podman", args: ["ps"] });
    expect(d.runSandboxed).toHaveBeenCalledWith({ program: "podman", args: ["ps"] }, { enforceFloor: true });
    expect(res.stdout).toBe("out");
    expect(res.awaitingApproval).toBeFalsy();
  });

  it("remember mode: rejects a cached-block command without running or prompting", async () => {
    const events: any[] = [];
    const d = deps({
      mode: "remember",
      onEvent: (e: any) => events.push(e),
      cacheLookup: cache([JSON.stringify(["docker", ["system", "prune"]]), "block"]),
    });
    const res = await runCommandTool(d, { program: "docker", args: ["system", "prune"] });
    expect(d.runSandboxed).not.toHaveBeenCalled();
    expect(res.rejected).toBe(true);
    expect(events.some((e) => e.type === "approval-request")).toBe(false);
  });

  it("remember mode: asks for a not-yet-decided command", async () => {
    const d = deps({ mode: "remember", cacheLookup: cache() });
    const res = await runCommandTool(d, { program: "podman", args: ["stop", "web"] });
    expect(d.runSandboxed).not.toHaveBeenCalled();
    expect(res.awaitingApproval).toBe(true);
  });

  it("remember mode: the floor still rejects a catastrophic command even if not cached", async () => {
    const d = deps({ mode: "remember", cacheLookup: cache() });
    const res = await runCommandTool(d, { program: "sudo", args: ["reboot"] });
    expect(d.runSandboxed).not.toHaveBeenCalled();
    expect(res.rejected).toBe(true);
  });

  it("allow mode: runs everything with the floor disabled (no prompt, no cache)", async () => {
    const d = deps({ mode: "allow" });
    const res = await runCommandTool(d, { program: "sudo", args: ["reboot"] });
    expect(d.runSandboxed).toHaveBeenCalledWith({ program: "sudo", args: ["reboot"] }, { enforceFloor: false });
    expect(res.awaitingApproval).toBeFalsy();
    expect(res.rejected).toBeFalsy();
  });
});

describe("searchKnowledgeTool", () => {
  it("returns trimmed knowledge hits", async () => {
    const searchKnowledge = vi.fn(async () => [
      {
        id: "a",
        domain: "podman" as const,
        title: "T",
        symptom: "s",
        solution: "fix",
        commands: ["podman info"],
      },
    ]);
    const res = await searchKnowledgeTool({ runSandboxed: okExec, searchKnowledge, mode: "ask" }, { query: "socket" });
    expect(res.results[0]).toMatchObject({ id: "a", title: "T", solution: "fix" });
  });
});

describe("webSearchTool — gated like a command, remembered as one switch", () => {
  it("allow mode: returns the searcher's text", async () => {
    const webSearch = vi.fn(async () => ({ text: "web result" }));
    const res = await webSearchTool(
      { runSandboxed: okExec, searchKnowledge: vi.fn(), webSearch, mode: "allow" },
      { query: "podman socket" },
    );
    expect(res.text).toBe("web result");
  });

  it("ask mode: asks each time and does not run the search", async () => {
    const events: any[] = [];
    const webSearch = vi.fn(async () => ({ text: "web result" }));
    const res = await webSearchTool(
      { runSandboxed: okExec, searchKnowledge: vi.fn(), webSearch, mode: "ask", onEvent: (e: any) => events.push(e) },
      { query: "podman socket" },
    );
    expect(webSearch).not.toHaveBeenCalled();
    expect(res.awaitingApproval).toBe(true);
    expect(events.find((e) => e.type === "approval-request")).toMatchObject({ kind: "web", args: ["podman socket"] });
  });

  it("remember mode: runs when the web switch is 'allow', refuses when 'block'", async () => {
    const webSearch = vi.fn(async () => ({ text: "web result" }));
    const okRes = await webSearchTool(
      { runSandboxed: okExec, searchKnowledge: vi.fn(), webSearch, mode: "remember", webVerdict: "allow" },
      { query: "q" },
    );
    expect(okRes.text).toBe("web result");

    const blocked = await webSearchTool(
      { runSandboxed: okExec, searchKnowledge: vi.fn(), webSearch, mode: "remember", webVerdict: "block" },
      { query: "q" },
    );
    expect(blocked.awaitingApproval).toBe(false);
    expect(webSearch).toHaveBeenCalledTimes(1); // only the allowed call ran
  });
});

describe("createAgentTools — wiring", () => {
  it("exposes runCommand + searchKnowledge always, and webSearch only when a searcher is provided", () => {
    const withoutWeb = createAgentTools(deps());
    expect(withoutWeb.runCommand).toBeDefined();
    expect(withoutWeb.searchKnowledge).toBeDefined();
    expect(withoutWeb.webSearch).toBeUndefined();

    const withWeb = createAgentTools(deps({ webSearch: vi.fn(async () => ({ text: "x" })) }));
    expect(withWeb.webSearch).toBeDefined();
  });
});
