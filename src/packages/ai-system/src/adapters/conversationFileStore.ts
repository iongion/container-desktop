import PQueue from "p-queue";
import {
  type ConversationRecordV1,
  type ConversationStore,
  parseConversationFile,
  prepareConversationFile,
} from "@/ai-system/core/conversations";
import type { IFileSystem, IPath } from "@/host-contract/fs";
import { readTextFileOrNull, writePrivateFileViaTempRename } from "./fsHelpers";

export function createConversationFileStore(filePath: string, fs: IFileSystem, path: IPath): ConversationStore {
  const writes = new PQueue({ concurrency: 1 });

  return {
    async load() {
      let text: string | null;
      try {
        text = await readTextFileOrNull(fs, filePath);
      } catch {
        return { status: "error", records: [], path: filePath };
      }
      if (text === null) return { status: "missing", records: [], path: filePath };
      return { ...parseConversationFile(text), path: filePath };
    },

    save(records: ConversationRecordV1[]) {
      // Validate/serialise synchronously so an invalid record still throws at the call site, then serialise
      // the file writes through a concurrency-1 queue (ordered, continue-on-error) — same as the old chain.
      const file = prepareConversationFile(records);
      return writes.add(() => writePrivateFileViaTempRename(fs, path, filePath, JSON.stringify(file, null, 2)));
    },
  };
}
