// DEV-only debug hook. `window.__assistantDemo.seed()` loads a synthetic transcript into the active AI
// Thread so the assistant's rendering — markdown, code, tables, generative cards, approvals, errors,
// streaming — can be exercised deterministically without a live model, then opens the console. Installed
// only under import.meta.env.DEV (see index.tsx), so it is tree-shaken from production.
//
// The transcript is static DATA (src/resources/configs/demoTranscript.json); the assistant's markdown reply
// lives in a template (demo-assistant-message.md). They are composed here — the sole reason a loader exists —
// by swapping the "@demo-assistant-message" placeholder for the template string. The ?raw imports use
// RELATIVE paths (like templateRegistry.vite.ts): TS resolves a relative "?raw" specifier to Vite's ambient
// string module, whereas an aliased "@/…?raw" is treated as a missing file.

import type { ThreadTimelineItem, ThreadView } from "@/ai-system/core/threadEvents";
import { emptyThreadView } from "@/ai-system/core/threadReducer";
import { useUIStore } from "@/web-app/stores/uiStore";
import { replaceAIViewForDev, useAIStore } from "@/web-app/stores/useAIStore";
import demoTranscriptJson from "../../../resources/configs/demoTranscript.json?raw";
import demoAssistantMarkdown from "../../../resources/prompts/demo-assistant-message.md?raw";

function demoItems(): ThreadTimelineItem[] {
  const items = JSON.parse(demoTranscriptJson) as Array<Record<string, unknown>>;
  return items.map((it) =>
    it.content === "@demo-assistant-message" ? { ...it, content: demoAssistantMarkdown } : it,
  ) as ThreadTimelineItem[];
}

export function installAssistantDemo(): void {
  (window as any).__assistantDemo = {
    async seed(open = true) {
      const ai = useAIStore.getState();
      if (!ai.activeThreadId) {
        await ai.newThread();
      }
      const state = useAIStore.getState();
      const sid = state.activeThreadId as string;
      replaceAIViewForDev(sid, { ...(state.views[sid] ?? emptyThreadView(sid)), timeline: demoItems() });
      if (open) {
        useUIStore.getState().setAssistantConsoleOpen(true);
      }
      return sid;
    },
    clear() {
      const state = useAIStore.getState();
      const sid = state.activeThreadId;
      if (sid) {
        replaceAIViewForDev(sid, { ...(state.views[sid] ?? emptyThreadView(sid)), timeline: [] });
      }
    },
    setBusy(on = true) {
      const state = useAIStore.getState();
      const sid = state.activeThreadId;
      if (sid) {
        const view: ThreadView = {
          ...(state.views[sid] ?? emptyThreadView(sid)),
          phase: on ? "model" : "idle",
        };
        replaceAIViewForDev(sid, view);
      }
      return sid;
    },
  };
}
