import PQueue from "p-queue";
import { parseThreadFile, prepareThreadFile, type ThreadRecord, type ThreadStore } from "@/ai-system/core/threads";
import type { IFileSystem, IPath } from "@/host-contract/fs";
import { readTextFileOrNull, writePrivateFileViaTempRename } from "./fsHelpers";

export function createThreadFileStore(
  filePath: string,
  fs: IFileSystem,
  path: IPath,
  legacyFilePath?: string,
): ThreadStore {
  const writes = new PQueue({ concurrency: 1 });

  return {
    async load() {
      let text: string | null;
      try {
        text = await readTextFileOrNull(fs, filePath);
      } catch {
        return { status: "error", records: [], path: filePath };
      }
      if (text === null && legacyFilePath) {
        try {
          text = await readTextFileOrNull(fs, legacyFilePath);
        } catch {
          return { status: "error", records: [], path: filePath };
        }
      }
      if (text === null) return { status: "missing", records: [], path: filePath };
      return { ...parseThreadFile(text), path: filePath };
    },

    save(records: ThreadRecord[]) {
      // Validate/serialise synchronously so an invalid record still throws at the call site, then serialise
      // the file writes through a concurrency-1 queue (ordered, continue-on-error) — same as the old chain.
      const file = prepareThreadFile(records);
      return writes.add(() => writePrivateFileViaTempRename(fs, path, filePath, JSON.stringify(file, null, 2)));
    },
  };
}
