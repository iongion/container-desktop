// File-backed storage for the knowledge bank. Runtime implementation: reads/writes
// a single JSON file in userData using node:fs directly (the `FS` global is a renderer/preload bridge).
// Lives in runtimes/node because it depends on node:*. See host/knowledgeBank.ts for the class.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { KnowledgeBankData, KnowledgeStorage } from "@/ai-system/host/knowledgeBank";

export function createFileKnowledgeStorage(filePath: string): KnowledgeStorage {
  return {
    async load() {
      try {
        const text = await readFile(filePath, "utf8");
        return JSON.parse(text) as KnowledgeBankData;
      } catch {
        return null;
      }
    },
    async save(data: KnowledgeBankData) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    },
  };
}
