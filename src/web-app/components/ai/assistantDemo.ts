// DEV-only debug hook. `window.__assistantDemo.seed()` loads a synthetic transcript into the active AI
// session so the assistant's rendering — markdown, code, tables, generative cards, approvals, errors,
// streaming — can be exercised deterministically without a live model, then opens the console. Installed
// only under import.meta.env.DEV (see index.tsx), so it is tree-shaken from production.
//
// The transcript is static DATA (src/resources/configs/demoTranscript.json); the assistant's markdown reply
// lives in a template (demo-assistant-message.md). They are composed here — the sole reason a loader exists —
// by swapping the "@demo-assistant-message" placeholder for the template string. The ?raw imports use
// RELATIVE paths (like templateRegistry.vite.ts): TS resolves a relative "?raw" specifier to Vite's ambient
// string module, whereas an aliased "@/…?raw" is treated as a missing file.

import type { TranscriptItem } from "@/ai-system/ui/core/transcript";
import { useAIStore } from "@/ai-system/ui/react/stores/useAIStore";
import { useUIStore } from "@/web-app/stores/uiStore";
import demoTranscriptJson from "../../../resources/configs/demoTranscript.json?raw";
import demoAssistantMarkdown from "../../../resources/prompts/demo-assistant-message.md?raw";

function demoItems(): TranscriptItem[] {
  const items = JSON.parse(demoTranscriptJson) as Array<Record<string, unknown>>;
  return items.map((it) =>
    it.content === "@demo-assistant-message" ? { ...it, content: demoAssistantMarkdown } : it,
  ) as TranscriptItem[];
}

export function installAssistantDemo(): void {
  (window as any).__assistantDemo = {
    seed(open = true) {
      const ai = useAIStore.getState() as any;
      if (!ai.activeSessionId) {
        ai.newSession();
      }
      const sid = (useAIStore.getState() as any).activeSessionId;
      useAIStore.setState((s: any) => ({ timelines: { ...s.timelines, [sid]: demoItems() } }));
      if (open) {
        useUIStore.getState().setAssistantConsoleOpen(true);
      }
      return sid;
    },
    clear() {
      const sid = (useAIStore.getState() as any).activeSessionId;
      if (sid) {
        useAIStore.setState((s: any) => ({ timelines: { ...s.timelines, [sid]: [] } }));
      }
    },
    setBusy(on = true) {
      const sid = (useAIStore.getState() as any).activeSessionId;
      if (sid) {
        useAIStore.setState((s: any) => ({ busy: { ...s.busy, [sid]: on } }));
      }
      return sid;
    },
  };
}
