import PQueue from "p-queue";

import {
  type ProjectContextStore,
  parseProjectContextStore,
  prepareProjectContextStore,
} from "@/ai-system/core/projectContext";
import type { IFileSystem, IPath } from "@/host-contract/fs";
import { readTextFileOrNull, writePrivateFileViaTempRename } from "./fsHelpers";

export function createProjectContextFileStore(filePath: string, fs: IFileSystem, path: IPath): ProjectContextStore {
  const writes = new PQueue({ concurrency: 1 });
  return {
    async load() {
      let text: string | null;
      try {
        text = await readTextFileOrNull(fs, filePath);
      } catch {
        return { status: "error", workspaces: [], path: filePath };
      }
      if (text === null) return { status: "missing", workspaces: [], path: filePath };
      return { ...parseProjectContextStore(text), path: filePath };
    },
    save(workspaces) {
      const file = prepareProjectContextStore(workspaces);
      return writes.add(() =>
        writePrivateFileViaTempRename(fs, path, filePath, JSON.stringify(file, null, 2)),
      ) as Promise<void>;
    },
  };
}
