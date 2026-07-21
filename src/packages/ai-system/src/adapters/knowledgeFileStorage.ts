// Neutral, FS-port-backed storage for the knowledge bank — a single private JSON blob. Both shells pass their
// platform IFileSystem/IPath (Electron main -> platform/electron/host FS/Path; Tauri webview -> window.FS/window.Path), so
// there is ONE impl and no node:* here. load returns null on any problem (missing / unreadable / unparseable);
// save writes the JSON blob privately (0600 on the Node impl). See host/knowledgeBank.ts for the class.

import type { KnowledgeBankData, KnowledgeStorage } from "@/ai-system/host/knowledgeBank";
import type { IFileSystem, IPath } from "@/host-contract/fs";

import { readTextFileOrNull, writePrivateFileEnsuringDir } from "./fsHelpers";

export function createKnowledgeFileStorage(filePath: string, fs: IFileSystem, path: IPath): KnowledgeStorage {
  return {
    async load() {
      let text: string | null;
      try {
        text = await readTextFileOrNull(fs, filePath);
      } catch {
        return null;
      }
      if (text === null) {
        return null;
      }
      try {
        return JSON.parse(text) as KnowledgeBankData;
      } catch {
        return null;
      }
    },
    async save(data: KnowledgeBankData) {
      await writePrivateFileEnsuringDir(fs, path, filePath, JSON.stringify(data, null, 2));
    },
  };
}
