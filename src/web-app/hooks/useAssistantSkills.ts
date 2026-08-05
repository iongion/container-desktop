import { useCallback, useEffect, useMemo, useState } from "react";

import { AI_CHANNELS } from "@/ai-system/core/channels";
import { describeError } from "@/ai-system/core/errors";
import type { SkillHostSnapshot } from "@/ai-system/core/skills";
import {
  piBuiltinCommandDefinitions,
  piPluginCommandDefinitions,
} from "@/ai-system/ui/core/commands/piSessionCommands";
import { pluginSkillCommands } from "@/ai-system/ui/core/commands/pluginCommands";
import { createSkillCommandRegistry } from "@/ai-system/ui/core/commands/skillCommands";
import { createLogger } from "@/logger";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

const logger = createLogger("web.ai.skills");

// pi's commands whose PALETTE ENTRY the app owns, declared in its own catalogue under pi's own names. Two reasons a
// name is here: the app performs the command (a host file dialog, the OS keychain, the clipboard), or the session
// performs it but the app owns the entry — `/new` and `/reload` are session-venue and still listed, because a second
// entry at the same path is a duplicate the registry would have to drop.
const APP_PERFORMED_PI_COMMANDS = [
  "new",
  "quit",
  "session",
  "copy",
  "export",
  "model",
  "reload",
  "import",
  "share",
  "login",
  "logout",
] as const;
const EMPTY_SNAPSHOT: SkillHostSnapshot = {
  revision: "0",
  user: { root: "…", status: "error" },
  skills: [],
  diagnostics: [],
};

function newerSnapshot(current: SkillHostSnapshot, next: SkillHostSnapshot): SkillHostSnapshot {
  return Number(next.revision) >= Number(current.revision) ? next : current;
}

export function useAssistantSkills() {
  const [snapshot, setSnapshot] = useState<SkillHostSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  // Everything the running session contributes: pi's OWN commands under pi's own names, what its plugins
  // registered with pi, and their skills. All of it changes when a plugin is installed, disabled or the session
  // stops, which is why it is read from the store rather than assembled once.
  const resources = useCodingAgentStore((state) => state.resources);
  const sessionCommands = useMemo(
    () => [
      // The app's own catalogue already offers the ones the GUI performs, under exactly these names.
      ...piBuiltinCommandDefinitions(resources.builtins, APP_PERFORMED_PI_COMMANDS),
      ...piPluginCommandDefinitions(resources),
      ...pluginSkillCommands(resources),
    ],
    [resources],
  );

  useEffect(() => {
    let mounted = true;
    const apply = (next: SkillHostSnapshot) => {
      if (!mounted) return;
      setSnapshot((current) => newerSnapshot(current, next));
      setError(undefined);
      setLoading(false);
    };
    const unsubscribe = window.AIBus.subscribe(AI_CHANNELS.skillsChanged, apply);
    void window.AI.getSkills().then(apply, (cause) => {
      if (!mounted) return;
      const message = describeError(cause);
      logger.error("Skill snapshot failed", { error: message });
      setError(message);
      setLoading(false);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const mutate = useCallback(async (operation: () => Promise<SkillHostSnapshot>) => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await operation();
      setSnapshot((current) => newerSnapshot(current, next));
      return next;
    } catch (cause) {
      const message = describeError(cause);
      logger.error("Skill operation failed", { error: message });
      setError(message);
      throw cause;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    snapshot,
    registry: useMemo(() => createSkillCommandRegistry(snapshot, sessionCommands), [snapshot, sessionCommands]),
    loading,
    error,
    reload: useCallback(() => mutate(() => window.AI.reloadSkills()), [mutate]),
    setProjectSourceEnabled: useCallback(
      (enabled: boolean) => mutate(() => window.AI.setProjectSkillsEnabled(enabled)),
      [mutate],
    ),
    setProjectSkillTrust: useCallback(
      (skillId: string, fingerprint: string, trusted: boolean) =>
        mutate(() => window.AI.setProjectSkillTrust(skillId, fingerprint, trusted)),
      [mutate],
    ),
  };
}
