import EventEmitter from "eventemitter3";
import { describe, expect, it } from "vitest";

import { installFakeCommand } from "@/__tests__/setup/fakeCommand";
import { ContainerEngine, ContainerEngineHost, OperatingSystem, Presence } from "@/env/Types";

import { buildPlan } from "./planBuilder";
import {
  commandsForStep,
  detectPrograms,
  type ProgramProbe,
  ProvisioningService,
  stepPlan,
} from "./provisioningService";
import type { DetectionReport, ProvisionStep, ProvisionTarget, StepEvent, StepKind } from "./types";

const target = (over: Partial<ProvisionTarget> = {}): ProvisionTarget => ({
  engine: ContainerEngine.PODMAN,
  host: ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
  strategy: "colima.lima",
  ...over,
});

const step = (kind: StepKind): ProvisionStep => ({ id: kind, kind, title: kind, longRunning: false });

describe("stepPlan", () => {
  it("routes engine/VM/distro creation to the per-OS provision action", () => {
    expect(stepPlan(step("install-engine"), target()).kind).toBe("provision");
    expect(stepPlan(step("create-vm"), target()).kind).toBe("provision");
    expect(stepPlan(step("import-distro"), target()).kind).toBe("provision");
  });

  it("treats reuse-scope, configure-volumes and connect as succeed-in-place", () => {
    expect(stepPlan(step("reuse-scope"), target()).kind).toBe("ok");
    expect(stepPlan(step("configure-volumes"), target()).kind).toBe("ok");
    expect(stepPlan(step("connect"), target()).kind).toBe("ok");
  });

  it("routes verify to the availability probe", () => {
    expect(stepPlan(step("verify"), target()).kind).toBe("verify");
  });
});

describe("detectPrograms", () => {
  const probe: ProgramProbe = async (name) =>
    name === "podman" ? { path: "/usr/bin/podman", version: "5.0.0" } : undefined;

  it("reports a found program as AVAILABLE with its path and version", async () => {
    const [podman] = await detectPrograms(["podman"], OperatingSystem.Linux, probe);
    expect(podman).toEqual({ name: "podman", present: Presence.AVAILABLE, path: "/usr/bin/podman", version: "5.0.0" });
  });

  it("reports a program the probe can't find as MISSING", async () => {
    const [docker] = await detectPrograms(["docker"], OperatingSystem.Linux, probe);
    expect(docker).toEqual({ name: "docker", present: Presence.MISSING });
  });

  it("preserves the requested program order", async () => {
    const found = await detectPrograms(["docker", "podman"], OperatingSystem.Linux, probe);
    expect(found.map((p) => p.name)).toEqual(["docker", "podman"]);
  });

  it("reports each result to onResult as it resolves (so the UI can tick incrementally)", async () => {
    const seen: string[] = [];
    await detectPrograms(["docker", "podman"], OperatingSystem.Linux, probe, (p) =>
      seen.push(`${p.name}:${p.present}`),
    );
    expect(seen).toEqual(["docker:missing", "podman:available"]);
  });
});

describe("commandsForStep", () => {
  it("emits podman machine init + start for a Podman create-vm", () => {
    const cmds = commandsForStep(step("create-vm"), target({ engine: ContainerEngine.PODMAN }), OperatingSystem.MacOS);
    expect(cmds[0].program).toBe("podman");
    expect(cmds[0].args.slice(0, 2)).toEqual(["machine", "init"]);
    expect(cmds.some((c) => c.args[1] === "start")).toBe(true);
  });

  it("installs the engine via a package-manager script for a native install", () => {
    const cmds = commandsForStep(
      step("install-engine"),
      target({ engine: ContainerEngine.DOCKER, strategy: "native.install" }),
      OperatingSystem.Linux,
    );
    expect(cmds[0].program).toBe("sh");
    expect(cmds[0].args[1]).toMatch(/docker/);
    expect(cmds[0].scope).toBeUndefined();
  });

  it("runs the install INSIDE the guest for a create strategy (scope set)", () => {
    const cmds = commandsForStep(
      step("install-engine"),
      target({ engine: ContainerEngine.PODMAN, strategy: "colima.lima" }),
      OperatingSystem.MacOS,
    );
    expect(cmds[0].scope).toBe("container-desktop");
  });

  it("provisions Apple Container + socktainer on the host for an apple.container install", () => {
    const cmds = commandsForStep(
      step("install-engine"),
      target({ engine: ContainerEngine.APPLE, strategy: "apple.container" }),
      OperatingSystem.MacOS,
    );
    expect(cmds.length).toBeGreaterThanOrEqual(2);
    // Apple Container provisions on the macOS host, so nothing is scoped into a VM.
    expect(cmds.every((c) => c.program === "sh" && c.scope === undefined)).toBe(true);
    expect(cmds[0].args[1]).toContain("container system start");
    expect(cmds[1].args[1]).toContain("socktainer");
  });

  it("returns no host command for control-only steps", () => {
    expect(commandsForStep(step("connect"), target(), OperatingSystem.Linux)).toEqual([]);
  });
});

const detection = (osType: OperatingSystem): DetectionReport => ({ osType, programs: [], scopes: [] });

// A streaming Command double whose ExecuteStreaming replays a stdout line then exits with the given code,
// so the exit-code → step outcome path is exercisable (installFakeCommand always exits 0).
function installStreamingCommand(exitCode: number, line = "working…") {
  const previous = (globalThis as any).Command;
  (globalThis as any).Command = {
    async ExecuteStreaming() {
      const em = new EventEmitter();
      setTimeout(() => {
        em.emit("data", { from: "stdout", data: `${line}\n` });
        em.emit("exit", { code: exitCode });
      }, 0);
      return { on: (e: any, l: any) => em.on(e, l), off: () => {}, dispose: () => {}, kill: () => {} };
    },
  };
  return () => {
    (globalThis as any).Command = previous;
  };
}

describe("ProvisioningService.run", () => {
  it("drives a whole plan to done, starting every step and streaming the machine-create command", async () => {
    const fake = installFakeCommand();
    try {
      const plan = buildPlan(detection(OperatingSystem.MacOS), target({ strategy: "colima.lima" }));
      const events: StepEvent[] = [];
      const overall = await new ProvisioningService(OperatingSystem.MacOS).run(plan, (e) => events.push(e));
      expect(overall).toBe("done");
      const started = events.filter((e) => e.type === "step.start").map((e) => e.id);
      expect(started).toEqual(plan.steps.map((s) => s.id));
      expect(fake.calls.some((c) => c.args.includes("machine") && c.args.includes("init"))).toBe(true);
    } finally {
      fake.restore();
    }
  });

  it("fails the run at the first provision step whose command exits non-zero", async () => {
    const restore = installStreamingCommand(1);
    try {
      const plan = buildPlan(detection(OperatingSystem.MacOS), target({ strategy: "colima.lima" }));
      const events: StepEvent[] = [];
      const overall = await new ProvisioningService(OperatingSystem.MacOS).run(plan, (e) => events.push(e));
      expect(overall).toBe("failed");
      const fail = events.find((e) => e.type === "step.fail");
      expect(fail?.id).toBe("create-vm");
    } finally {
      restore();
    }
  });

  it("runs the injected verify hook and streams its readiness lines", async () => {
    const fake = installFakeCommand();
    try {
      const plan = buildPlan(detection(OperatingSystem.MacOS), target({ strategy: "colima.lima" }));
      const events: StepEvent[] = [];
      await new ProvisioningService(OperatingSystem.MacOS).run(plan, (e) => events.push(e), {
        verify: async () => ({
          ready: true,
          items: [{ key: "api", label: "Engine reachable", ok: true, detail: "ok" }],
        }),
      });
      const verifyLines = events.filter(
        (e): e is Extract<StepEvent, { type: "step.line" }> => e.type === "step.line" && e.id === "verify",
      );
      expect(verifyLines.some((l) => l.line.includes("Engine reachable"))).toBe(true);
    } finally {
      fake.restore();
    }
  });
});
