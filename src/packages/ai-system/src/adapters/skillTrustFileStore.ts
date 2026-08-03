import PQueue from "p-queue";

import { parseSkillTrustFile, prepareSkillTrustFile, type SkillTrustStore } from "@/ai-system/core/skillTrust";
import type { IFileSystem, IPath } from "@/host-contract/fs";
import { readTextFileOrNull, writePrivateFileViaTempRename } from "./fsHelpers";

export function createSkillTrustFileStore(filePath: string, fs: IFileSystem, path: IPath): SkillTrustStore {
  const writes = new PQueue({ concurrency: 1 });
  return {
    async load() {
      let text: string | null;
      try {
        text = await readTextFileOrNull(fs, filePath);
      } catch {
        return { status: "error", path: filePath, sources: [], skills: [] };
      }
      if (text === null) return { status: "missing", path: filePath, sources: [], skills: [] };
      return { ...parseSkillTrustFile(text), path: filePath };
    },
    save(snapshot) {
      const file = prepareSkillTrustFile(snapshot);
      return writes.add(() =>
        writePrivateFileViaTempRename(fs, path, filePath, JSON.stringify(file, null, 2)),
      ) as Promise<void>;
    },
  };
}
