import type { ThreadCompaction } from "@/ai-system/core/threads";
import threadCompactionContextMarkdown from "@/resources/prompts/thread-compaction-context.md?raw";
import { renderPrompt } from "@/template/renderPrompt";

export function buildThreadCompactionContext(compaction: ThreadCompaction): string {
  return renderPrompt(threadCompactionContextMarkdown, {
    historyStart: compaction.source.historyStart,
    historyEnd: compaction.source.historyEnd,
    contentTrust: compaction.contentTrust,
    tainted: compaction.tainted,
    summary: compaction.summary,
  });
}
