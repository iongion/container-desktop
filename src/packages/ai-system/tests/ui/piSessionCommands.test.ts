import { describe, expect, it } from "vitest";

import { createAssistantCommandRegistry } from "@/ai-system/ui/core/commands/commandRegistry";
import {
  piBuiltinCommandDefinitions,
  piPluginCommandDefinitions,
} from "@/ai-system/ui/core/commands/piSessionCommands";
import type { ContributedResources, PiBuiltinCommand } from "@/pi-bridge/protocol";

const builtins: PiBuiltinCommand[] = [
  { name: "compact", description: "Manually compact the session context", runsIn: "session" },
  { name: "name", description: "Set session display name", runsIn: "session" },
  { name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>", runsIn: "app" },
  {
    name: "login",
    description: "Configure provider authentication",
    runsIn: "unavailable",
    reason: "the provider key stays in a separate gateway container",
  },
];

const resources = (patch: Partial<ContributedResources> = {}): ContributedResources => ({
  extensions: [],
  commands: [],
  skills: [],
  prompts: [],
  builtins: [],
  ...patch,
});

describe("piBuiltinCommandDefinitions", () => {
  // The whole point: a user who knows pi types what they know. No prefix, no rename, no merging into an app command
  // of similar purpose.
  it("offers pi's commands under pi's exact names and wording", () => {
    const definitions = piBuiltinCommandDefinitions(builtins);
    expect(definitions.map((definition) => definition.path)).toEqual(["/compact", "/name", "/login"]);
    expect(definitions[0]).toMatchObject({
      kind: "pi",
      commandName: "compact",
      venue: "session",
      description: { kind: "literal", value: "Manually compact the session context" },
    });
  });

  it("carries pi's argument hint through", () => {
    const withHint = piBuiltinCommandDefinitions([
      { name: "export", description: "Export session", argumentHint: "[path]", runsIn: "session" },
    ]);
    expect(withHint[0]).toMatchObject({ argumentHint: { kind: "literal", value: "[path]" } });
  });

  // The GUI performs these itself, under the same name — listing them here too would only give the registry a
  // duplicate to drop, which would take BOTH out of the palette.
  it("leaves the commands the app performs to the app's own catalogue", () => {
    expect(piBuiltinCommandDefinitions(builtins, ["session"]).map((d) => d.commandName)).not.toContain("model");
    expect(piBuiltinCommandDefinitions(builtins, ["compact"]).map((d) => d.commandName)).not.toContain("compact");
  });

  it("keeps a command it cannot honour, with the reason", () => {
    const login = piBuiltinCommandDefinitions(builtins).find((d) => d.commandName === "login");
    expect(login).toMatchObject({
      venue: "unavailable",
      unavailableReason: "the provider key stays in a separate gateway container",
      // Reachable in every phase: a refusal that needs an idle turn to be explained explains nothing.
      availabilityId: "always",
    });
  });
});

describe("piPluginCommandDefinitions", () => {
  it("offers a plugin's command and prompt under their own names", () => {
    const definitions = piPluginCommandDefinitions(
      resources({
        commands: [{ name: "hello", description: "Say hello", source: "pi-plugin-hello" }],
        prompts: [{ name: "review", source: "pi-plugin-review" }],
      }),
    );
    expect(definitions.map((definition) => definition.path)).toEqual(["/hello", "/review"]);
    expect(definitions[0]).toMatchObject({
      venue: "prompt",
      source: { kind: "pi-plugin", pluginId: "pi-plugin-hello" },
    });
    // No description from the plugin: naming the package it came from is more use than an empty line.
    expect(definitions[1]).toMatchObject({ description: { kind: "literal", value: "pi-plugin-review" } });
  });
});

// This is what was broken: a plugin command was built as a "skill", and the registry drops any skill that does not
// answer to `/skill:<name>` — so every plugin command was silently absent from the palette it was built for.
describe("the registry", () => {
  it("registers a plugin's own command under its own name", () => {
    const registry = createAssistantCommandRegistry("t", [
      piPluginCommandDefinitions(resources({ commands: [{ name: "hello", source: "pi-plugin-hello" }] })),
    ]);
    expect(registry.conflicts).toEqual([]);
    expect(registry.byName["/hello"]).toMatchObject({ kind: "pi", commandName: "hello" });
  });

  it("registers pi's own commands", () => {
    const registry = createAssistantCommandRegistry("t", [piBuiltinCommandDefinitions(builtins)]);
    expect(registry.conflicts).toEqual([]);
    expect(Object.keys(registry.byName).sort()).toEqual(["/compact", "/login", "/name"]);
  });

  // A file in a skills directory must not be able to shadow one of pi's commands.
  it("reserves pi's names against a skill that tries to claim one", () => {
    const registry = createAssistantCommandRegistry("t", [
      piBuiltinCommandDefinitions(builtins),
      [
        {
          id: "skill:user:compact",
          kind: "skill" as const,
          skillId: "compact",
          path: "/compact" as const,
          aliases: [],
          category: { kind: "literal" as const, value: "Skills" },
          description: { kind: "literal" as const, value: "hijack" },
          hiddenSearchTerms: [],
          source: { kind: "user-skill" as const, fingerprint: "a".repeat(64) },
          bypassTier: "queued" as const,
          availabilityId: "session-idle" as const,
          confirmation: "none" as const,
          arguments: { kind: "text" as const, required: false },
          surfaces: ["assistant", "quake-console"] as const,
        },
      ],
    ]);
    expect(registry.byName["/compact"]).toMatchObject({ kind: "pi" });
    expect(registry.conflicts.map((conflict) => conflict.reason)).toContain("reserved");
  });
});
