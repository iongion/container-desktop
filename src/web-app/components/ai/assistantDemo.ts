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

import type { ChatSessionView, ChatTimelineItem } from "@/ai-system/core/chatEvents";
import { emptyChatSessionView } from "@/ai-system/core/chatReducer";
import { useUIStore } from "@/web-app/stores/uiStore";
import { replaceAIViewForDev, useAIStore } from "@/web-app/stores/useAIStore";
import demoTranscriptJson from "../../../resources/configs/demoTranscript.json?raw";
import demoAssistantMarkdown from "../../../resources/prompts/demo-assistant-message.md?raw";

function demoItems(): ChatTimelineItem[] {
  const items = JSON.parse(demoTranscriptJson) as Array<Record<string, unknown>>;
  return items.map((it) =>
    it.content === "@demo-assistant-message" ? { ...it, content: demoAssistantMarkdown } : it,
  ) as ChatTimelineItem[];
}

export function installAssistantDemo(): void {
  (window as any).__assistantDemo = {
    async seed(open = true) {
      const ai = useAIStore.getState();
      if (!ai.activeSessionId) {
        await ai.newSession();
      }
      const state = useAIStore.getState();
      const sid = state.activeSessionId as string;
      replaceAIViewForDev(sid, { ...(state.views[sid] ?? emptyChatSessionView(sid)), timeline: demoItems() });
      if (open) {
        useUIStore.getState().setAssistantConsoleOpen(true);
      }
      return sid;
    },
    clear() {
      const state = useAIStore.getState();
      const sid = state.activeSessionId;
      if (sid) {
        replaceAIViewForDev(sid, { ...(state.views[sid] ?? emptyChatSessionView(sid)), timeline: [] });
      }
    },
    setBusy(on = true) {
      const state = useAIStore.getState();
      const sid = state.activeSessionId;
      if (sid) {
        const view: ChatSessionView = {
          ...(state.views[sid] ?? emptyChatSessionView(sid)),
          phase: on ? "model" : "idle",
        };
        replaceAIViewForDev(sid, view);
      }
      return sid;
    },
  };
}
