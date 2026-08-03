import { useCallback, useEffect, useMemo, useState } from "react";

import { AI_CHANNELS } from "@/ai-system/core/channels";
import { describeError } from "@/ai-system/core/errors";
import type { SkillHostSnapshot } from "@/ai-system/core/skills";
import { createSkillCommandRegistry } from "@/ai-system/ui/core/commands/skillCommands";
import { createLogger } from "@/logger";

const logger = createLogger("web.ai.skills");
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
    registry: useMemo(() => createSkillCommandRegistry(snapshot), [snapshot]),
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
