import PQueue from "p-queue";
import { parseWorkerFile, prepareWorkerFile, type WorkerDefinition, type WorkerStore } from "@/ai-system/core/workers";
import type { IFileSystem, IPath } from "@/host-contract/fs";
import { readTextFileOrNull, writePrivateFileViaTempRename } from "./fsHelpers";

export function createWorkerFileStore(filePath: string, fs: IFileSystem, path: IPath): WorkerStore {
  const writes = new PQueue({ concurrency: 1 });

  return {
    async load() {
      let text: string | null;
      try {
        text = await readTextFileOrNull(fs, filePath);
      } catch {
        return { status: "error", workers: [], path: filePath };
      }
      if (text === null) return { status: "missing", workers: [], path: filePath };
      return { ...parseWorkerFile(text), path: filePath };
    },

    save(workers: WorkerDefinition[]) {
      // Validate/serialise synchronously so an invalid definition throws at the call site, then serialise the
      // writes through a concurrency-1 queue so two rapid saves cannot interleave into a torn file.
      const file = prepareWorkerFile(workers);
      return writes.add(() => writePrivateFileViaTempRename(fs, path, filePath, JSON.stringify(file, null, 2)));
    },
  };
}
