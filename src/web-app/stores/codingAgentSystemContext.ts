// What the app tells a running session about the project's rules and memories. The session assembles its own
// system prompt inside the container, so the app cannot compose one — it hands over prose, rendered from the same
// pack the Project context panel shows, through the same template the host used when the engine ran in this realm.

import type { EffectiveContextSource } from "@/ai-system/core/context";
import type { ProjectContextSnapshot } from "@/ai-system/core/projectContext";
import { buildProjectContextPrompt } from "@/template/prompts";
// Self-sufficient: the AI host installs the same templates at bootstrap, but a caller must not depend on having
// been loaded after it.
import "@/template/templateRegistry.vite";

export interface SessionSystemContext {
  text: string;
  // The prose is content the app did not author — a repository's rules file, an imported memory. A turn carrying
  // it must not honour a remembered allow, which is exactly what the pack's own `initialTaint` reports.
  tainted: boolean;
  // What went in, itemised, for the context panel's Sources list. The session can only report the composed prose;
  // this is the only place that still knows which rule file and how much of it.
  sources: EffectiveContextSource[];
}

export function composeSessionSystemContext(snapshot: ProjectContextSnapshot | undefined): SessionSystemContext {
  // An empty pack would render a heading with nothing under it: tokens spent telling the model a set exists.
  if (snapshot?.state !== "ready" || snapshot.pack.sections.length === 0) {
    return { text: "", tainted: false, sources: [] };
  }
  return {
    text: buildProjectContextPrompt(snapshot.pack),
    tainted: snapshot.pack.initialTaint,
    sources: snapshot.pack.sections.map((section) => ({
      kind: section.kind,
      trust: section.trust,
      characters: section.content.length,
    })),
  };
}
