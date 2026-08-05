import { describe, expect, it, vi } from "vitest";

import { isPiCommandName, PI_BUILTIN_COMMANDS, type PiCommandDeps, runPiCommand } from "@/pi-agent-host/piCommands";

function deps(overrides: Partial<PiCommandDeps> = {}): PiCommandDeps {
  return {
    session: {
      compact: vi.fn(async () => ({ summary: "the story so far", tokensBefore: 9000 })),
      setSessionName: vi.fn(),
      getUserMessagesForForking: vi.fn(() => [
        { entryId: "e1", text: "first ask" },
        { entryId: "e2", text: "second ask" },
      ]),
      navigateTree: vi.fn(async () => ({ cancelled: false, editorText: "second ask" })),
      reload: vi.fn(async () => {}),
      getSessionStats: vi.fn(),
    } as never,
    sessionManager: {
      getTree: vi.fn(() => [
        {
          entry: {
            type: "message",
            id: "e1",
            parentId: null,
            timestamp: "t0",
            message: { role: "user", content: "first ask" },
          },
          children: [],
        },
      ]),
      getSessionName: vi.fn(() => undefined),
      getLeafId: vi.fn(() => "e1"),
    } as never,
    runtime: {
      newSession: vi.fn(async () => ({ cancelled: false })),
      clone: vi.fn(async () => ({ cancelled: false })),
      switchSession: vi.fn(async () => ({ cancelled: false })),
    },
    listSessions: vi.fn(async () => [
      {
        path: "/sessions/older.jsonl",
        id: "s1",
        modified: "2026-08-01T10:00:00.000Z",
        messageCount: 4,
        firstMessage: "first ask",
        current: false,
      },
    ]),
    trust: {
      read: vi.fn(() => ({ decision: null, matters: true, path: "/workspace" })),
      write: vi.fn((trusted: boolean) => ({ decision: trusted, matters: true, path: "/workspace" })),
    },
    settings: {
      read: vi.fn(() => ({
        autoCompaction: true,
        steeringMode: "all" as const,
        followUpMode: "all" as const,
        thinkingLevel: "low",
        availableThinkingLevels: ["low", "high"],
      })),
      write: vi.fn(() => ({
        autoCompaction: false,
        steeringMode: "all" as const,
        followUpMode: "all" as const,
        thinkingLevel: "low",
        availableThinkingLevels: ["low", "high"],
      })),
    },
    models: {
      read: vi.fn(() => ({
        available: [{ id: "canned", name: "canned", provider: "container-desktop-gateway" }],
        scoped: [],
      })),
      write: vi.fn((ids: string[]) => ({
        available: [{ id: "canned", name: "canned", provider: "container-desktop-gateway" }],
        scoped: ids,
      })),
    },
    keybindings: () => [{ action: "tui.input.submit", keys: ["enter"] }],
    changelog: async () => "# pi\n\n## 1.2.3",
    ...overrides,
  };
}

describe("PI_BUILTIN_COMMANDS", () => {
  // Mirrored from pi's own catalogue, which pi does not export. The names ARE the contract: a user who knows pi
  // types what they know.
  it("carries pi's own names", () => {
    expect(PI_BUILTIN_COMMANDS.map((command) => command.name)).toEqual([
      "settings",
      "model",
      "scoped-models",
      "export",
      "import",
      "share",
      "copy",
      "name",
      "session",
      "changelog",
      "hotkeys",
      "fork",
      "clone",
      "tree",
      "trust",
      "login",
      "logout",
      "new",
      "compact",
      "resume",
      "reload",
      "quit",
    ]);
  });

  // Every one of pi's commands is honoured now — the nine that used to be refused described this app's wiring, not
  // pi's limits. `unavailable` survives as a type because a future pi command may genuinely not fit; if one ever
  // declares it, it still owes the user a reason.
  it("refuses none of pi's commands, and would explain any it did", () => {
    const unavailable = PI_BUILTIN_COMMANDS.filter((command) => command.runsIn === "unavailable");
    expect(unavailable).toEqual([]);
    for (const command of unavailable) expect(command.reason?.length ?? 0).toBeGreaterThan(0);
  });

  it("describes every command, in pi's words", () => {
    for (const command of PI_BUILTIN_COMMANDS) expect(command.description.length).toBeGreaterThan(0);
  });

  it("recognizes only pi's names", () => {
    expect(isPiCommandName("compact")).toBe(true);
    expect(isPiCommandName("compaction")).toBe(false);
  });
});

describe("runPiCommand", () => {
  it("compacts the session, and passes the user's instructions on", async () => {
    const harness = deps();
    await expect(runPiCommand(harness, "compact", "  keep the decisions  ")).resolves.toEqual({
      ok: true,
      data: { summary: "the story so far", tokensBefore: 9000 },
    });
    expect(harness.session.compact).toHaveBeenCalledWith("keep the decisions");
  });

  it("compacts with pi's own instructions when the user gave none", async () => {
    const harness = deps();
    await runPiCommand(harness, "compact", "");
    expect(harness.session.compact).toHaveBeenCalledWith(undefined);
  });

  it("names the session", async () => {
    const harness = deps();
    await expect(runPiCommand(harness, "name", "Release triage")).resolves.toEqual({
      ok: true,
      data: { name: "Release triage" },
    });
    expect(harness.session.setSessionName).toHaveBeenCalledWith("Release triage");
  });

  it("asks for a name rather than setting an empty one", async () => {
    const harness = deps();
    await expect(runPiCommand(harness, "name", "   ")).resolves.toMatchObject({ ok: false });
    expect(harness.session.setSessionName).not.toHaveBeenCalled();
  });

  // With no argument these are questions, not actions: the app shows what there is and the user names one. Data,
  // not prose — a GUI lays it out and a container cannot.
  it("answers with the fork points when asked without one", async () => {
    await expect(runPiCommand(deps(), "fork", "")).resolves.toEqual({
      ok: true,
      data: {
        forkPoints: [
          { entryId: "e1", text: "first ask" },
          { entryId: "e2", text: "second ask" },
        ],
      },
    });
  });

  it("forks to a point that exists, and refuses one that does not", async () => {
    const harness = deps();
    await expect(runPiCommand(harness, "fork", "e2")).resolves.toEqual({
      ok: true,
      data: { forkedFrom: "e2", editorText: "second ask" },
    });
    expect(harness.session.navigateTree).toHaveBeenCalledWith("e2");
    await expect(runPiCommand(harness, "fork", "nope")).resolves.toMatchObject({ ok: false });
  });

  it("answers with the session tree, and moves within it", async () => {
    const harness = deps();
    // Projected, not pi's raw tree: the app receives ids, pi's own entry kind and a short preview, and the leaf's
    // ancestry marked so a picker can show which branch is live.
    await expect(runPiCommand(harness, "tree", "")).resolves.toEqual({
      ok: true,
      data: {
        tree: [
          {
            id: "e1",
            kind: "message",
            role: "user",
            preview: "first ask",
            timestamp: "t0",
            current: true,
            children: [],
          },
        ],
      },
    });
    await expect(runPiCommand(harness, "tree", "e1")).resolves.toMatchObject({ ok: true });
    expect(harness.session.navigateTree).toHaveBeenCalledWith("e1");
  });

  it("reports a cancelled move as a failure rather than a silent success", async () => {
    const harness = deps({
      session: { ...deps().session, navigateTree: vi.fn(async () => ({ cancelled: true })) } as never,
    });
    await expect(runPiCommand(harness, "tree", "e1")).resolves.toMatchObject({ ok: false });
  });

  it("reloads the session's own resources", async () => {
    const harness = deps();
    await expect(runPiCommand(harness, "reload", "")).resolves.toMatchObject({ ok: true });
    expect(harness.session.reload).toHaveBeenCalled();
  });

  it("hands over pi's shipped changelog and the keys pi's own components answer to", async () => {
    await expect(runPiCommand(deps(), "changelog", "")).resolves.toEqual({
      ok: true,
      data: { markdown: "# pi\n\n## 1.2.3" },
    });
    await expect(runPiCommand(deps(), "hotkeys", "")).resolves.toEqual({
      ok: true,
      data: { bindings: [{ action: "tui.input.submit", keys: ["enter"] }] },
    });
  });

  // The four halves the GUI owns: they need a host file dialog, the host filesystem, the OS keychain or the app's
  // own settings, none of which the container has. A refusal here is the app forgetting to handle one.
  it("hands the app's own commands back to the app", async () => {
    for (const name of ["login", "logout", "share", "import", "export", "model", "copy", "session", "quit"]) {
      const result = await runPiCommand(deps(), name, "");
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toContain("performed by the app");
    }
  });

  // pi forks AT the leaf, which is what makes a clone the conversation as it stands rather than a rewind.
  it("clones the conversation at the point it is on", async () => {
    const harness = deps();
    await expect(runPiCommand(harness, "clone", "")).resolves.toEqual({ ok: true });
    expect(harness.runtime.clone).toHaveBeenCalledWith("e1");
  });

  // pi refuses to fork a session it has not written yet, and it has written nothing before the first reply. Saying
  // that up front beats surfacing pi's own error for a case the app can see coming.
  it("refuses to clone a conversation that has not started", async () => {
    const harness = deps({ sessionManager: { ...deps().sessionManager, getLeafId: vi.fn(() => null) } as never });
    await expect(runPiCommand(harness, "clone", "")).resolves.toMatchObject({ ok: false });
    expect(harness.runtime.clone).not.toHaveBeenCalled();
  });

  it("lists what there is to resume, then resumes the one chosen", async () => {
    const harness = deps();
    await expect(runPiCommand(harness, "resume", "")).resolves.toMatchObject({
      ok: true,
      data: { sessions: [{ id: "s1", path: "/sessions/older.jsonl", current: false }] },
    });
    await expect(runPiCommand(harness, "resume", "/sessions/older.jsonl")).resolves.toEqual({ ok: true });
    expect(harness.runtime.switchSession).toHaveBeenCalledWith("/sessions/older.jsonl");
  });

  it("reports a replacement an extension cancelled rather than claiming it happened", async () => {
    for (const key of ["clone", "switchSession"] as const) {
      const harness = deps();
      harness.runtime[key] = vi.fn(async () => ({ cancelled: true }));
      const result = await runPiCommand(
        harness,
        key === "clone" ? "clone" : "resume",
        key === "clone" ? "" : "/s.jsonl",
      );
      expect(result).toMatchObject({ ok: false });
    }
  });

  // Trust is a decision, so a bare command reports the one in force. It is stored in the AGENT dir, which is why
  // the old refusal — "pi writes nothing into your workspace" — was never the obstacle.
  it("reports the project trust decision, and records one in pi's own words", async () => {
    const harness = deps();
    await expect(runPiCommand(harness, "trust", "")).resolves.toEqual({
      ok: true,
      data: { trust: { decision: null, matters: true, path: "/workspace" } },
    });
    await expect(runPiCommand(harness, "trust", "on")).resolves.toMatchObject({
      ok: true,
      data: { trust: { decision: true } },
    });
    expect(harness.trust.write).toHaveBeenCalledWith(true);
    await expect(runPiCommand(harness, "trust", "maybe")).resolves.toMatchObject({ ok: false });
  });

  it("reports the session settings, and writes the one named", async () => {
    const harness = deps();
    await expect(runPiCommand(harness, "settings", "")).resolves.toMatchObject({
      ok: true,
      data: { settings: { autoCompaction: true, thinkingLevel: "low" } },
    });
    await expect(runPiCommand(harness, "settings", "autoCompaction off")).resolves.toMatchObject({ ok: true });
    expect(harness.settings.write).toHaveBeenCalledWith({ autoCompaction: false });
    await expect(runPiCommand(harness, "settings", "steeringMode one-at-a-time")).resolves.toMatchObject({ ok: true });
    expect(harness.settings.write).toHaveBeenCalledWith({ steeringMode: "one-at-a-time" });
  });

  // A setting that would not stick is worse than a refused one: the drawer would show the change and the session
  // would ignore it.
  it("refuses a setting it does not have, a value it cannot take, and a level this model cannot reach", async () => {
    const harness = deps();
    for (const line of ["nonsense on", "autoCompaction maybe", "steeringMode sometimes", "thinkingLevel max"]) {
      await expect(runPiCommand(harness, "settings", line)).resolves.toMatchObject({ ok: false });
    }
    expect(harness.settings.write).not.toHaveBeenCalled();
  });

  it("reports which models pi would cycle, narrows the set, and widens it again", async () => {
    const harness = deps();
    await expect(runPiCommand(harness, "scoped-models", "")).resolves.toMatchObject({
      ok: true,
      data: { models: { available: [{ id: "canned" }], scoped: [] } },
    });
    await expect(runPiCommand(harness, "scoped-models", "canned")).resolves.toMatchObject({ ok: true });
    expect(harness.models.write).toHaveBeenCalledWith(["canned"]);
    await expect(runPiCommand(harness, "scoped-models", "all")).resolves.toMatchObject({ ok: true });
    expect(harness.models.write).toHaveBeenCalledWith([]);
    await expect(runPiCommand(harness, "scoped-models", "gpt-9")).resolves.toMatchObject({ ok: false });
  });

  // A command the GUI performs reaching the container means the app forgot to handle it. Saying so beats doing
  // nothing and looking like a dead command.
  it("says so when handed a command the app performs", async () => {
    await expect(runPiCommand(deps(), "quit", "")).resolves.toMatchObject({ ok: false });
    await expect(runPiCommand(deps(), "export", "")).resolves.toMatchObject({ ok: false });
  });

  // A fresh conversation used to mean tearing the container pair down and building it again. pi's own runtime
  // replaces the session in place, so this is the session's own work now.
  it("starts a new session in process", async () => {
    const runtime = { ...deps().runtime, newSession: vi.fn(async () => ({ cancelled: false })) };
    await expect(runPiCommand(deps({ runtime }), "new", "")).resolves.toEqual({ ok: true });
    expect(runtime.newSession).toHaveBeenCalledTimes(1);
  });

  // An extension holding a `session_before_switch` handler can refuse. Reporting that as success would leave the
  // user looking at the old conversation believing it was cleared.
  it("reports a new session an extension refused", async () => {
    const runtime = { ...deps().runtime, newSession: vi.fn(async () => ({ cancelled: true })) };
    await expect(runPiCommand(deps({ runtime }), "new", "")).resolves.toMatchObject({ ok: false });
  });

  it("refuses a name pi does not have", async () => {
    await expect(runPiCommand(deps(), "sudo", "")).resolves.toMatchObject({
      ok: false,
      error: "unknown pi command: /sudo",
    });
  });
});
