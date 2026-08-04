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
    sessionManager: { getTree: vi.fn(() => [{ id: "e1" }]), getSessionName: vi.fn(() => undefined) } as never,
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

  // Offered and explained beats hidden: a pi user who types `/login` learns why this app cannot honour it, rather
  // than being told the command does not exist.
  it("gives every command it cannot honour a reason", () => {
    const unavailable = PI_BUILTIN_COMMANDS.filter((command) => command.runsIn === "unavailable");
    expect(unavailable.length).toBeGreaterThan(0);
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
    await expect(runPiCommand(harness, "tree", "")).resolves.toEqual({ ok: true, data: { tree: [{ id: "e1" }] } });
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

  it("refuses what this architecture cannot honour, with the architectural reason", async () => {
    for (const name of [
      "login",
      "logout",
      "share",
      "trust",
      "resume",
      "clone",
      "import",
      "settings",
      "scoped-models",
    ]) {
      const result = await runPiCommand(deps(), name, "");
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.length).toBeGreaterThan(10);
    }
  });

  // A command the GUI performs reaching the container means the app forgot to handle it. Saying so beats doing
  // nothing and looking like a dead command.
  it("says so when handed a command the app performs", async () => {
    await expect(runPiCommand(deps(), "new", "")).resolves.toMatchObject({ ok: false });
    await expect(runPiCommand(deps(), "quit", "")).resolves.toMatchObject({ ok: false });
  });

  it("refuses a name pi does not have", async () => {
    await expect(runPiCommand(deps(), "sudo", "")).resolves.toMatchObject({
      ok: false,
      error: "unknown pi command: /sudo",
    });
  });
});
