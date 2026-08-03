import PQueue from "p-queue";

import {
  parseToolArtifactFile,
  prepareToolArtifactFile,
  type ToolArtifactRecord,
  type ToolArtifactStore,
} from "@/ai-system/core/toolArtifacts";
import type { IFileSystem, IPath } from "@/host-contract/fs";
import { readTextFileOrNull, writePrivateFileViaTempRename } from "./fsHelpers";

export function createToolArtifactFileStore(filePath: string, fs: IFileSystem, path: IPath): ToolArtifactStore {
  const writes = new PQueue({ concurrency: 1 });
  return {
    async load() {
      try {
        const text = await readTextFileOrNull(fs, filePath);
        return text === null
          ? { status: "missing", records: [], path: filePath }
          : { ...parseToolArtifactFile(text), path: filePath };
      } catch {
        return { status: "error", records: [], path: filePath };
      }
    },
    save(records: ToolArtifactRecord[]) {
      const file = prepareToolArtifactFile(records);
      return writes.add(() => writePrivateFileViaTempRename(fs, path, filePath, JSON.stringify(file, null, 2)));
    },
  };
}
