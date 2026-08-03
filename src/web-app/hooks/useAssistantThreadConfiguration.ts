import { useCallback, useEffect, useState } from "react";
import { type AccessProfileId, DEFAULT_ACCESS_PROFILE } from "@/ai-system/core/accessProfiles";
import type { ReasoningLevel } from "@/ai-system/core/reasoning";
import type { ThreadConfigurationPatch } from "@/ai-system/core/threads";

export interface AssistantThreadBindings {
  providerId?: string;
  model?: string;
  accessProfile?: AccessProfileId;
  reasoningLevel?: ReasoningLevel;
  onChange?: (patch: ThreadConfigurationPatch) => Promise<unknown>;
}

export function useAssistantThreadConfiguration(bindings: AssistantThreadBindings | undefined, active: boolean) {
  const [accessProfile, setAccessProfile] = useState<AccessProfileId>(
    bindings?.accessProfile ?? DEFAULT_ACCESS_PROFILE,
  );
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>(bindings?.reasoningLevel ?? "default");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (active) return;
    setAccessProfile(bindings?.accessProfile ?? DEFAULT_ACCESS_PROFILE);
    setReasoningLevel(bindings?.reasoningLevel ?? "default");
  }, [active, bindings?.accessProfile, bindings?.reasoningLevel]);

  const update = useCallback(
    async (patch: ThreadConfigurationPatch) => {
      setPending(true);
      try {
        await bindings?.onChange?.(patch);
        if (patch.accessProfile !== undefined) setAccessProfile(patch.accessProfile);
        if (patch.reasoningLevel !== undefined) setReasoningLevel(patch.reasoningLevel);
      } finally {
        setPending(false);
      }
    },
    [bindings?.onChange],
  );

  return { accessProfile, reasoningLevel, pending, update };
}
