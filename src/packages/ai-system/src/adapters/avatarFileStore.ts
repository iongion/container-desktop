import PQueue from "p-queue";
import { type AvatarRecord, type AvatarStore, parseAvatarFile, prepareAvatarFile } from "@/ai-system/core/avatars";
import type { IFileSystem, IPath } from "@/host-contract/fs";
import { readTextFileOrNull, writePrivateFileViaTempRename } from "./fsHelpers";

export function createAvatarFileStore(filePath: string, fs: IFileSystem, path: IPath): AvatarStore {
  const writes = new PQueue({ concurrency: 1 });

  return {
    async load() {
      let text: string | null;
      try {
        text = await readTextFileOrNull(fs, filePath);
      } catch {
        return { status: "error", avatars: [], path: filePath };
      }
      if (text === null) return { status: "missing", avatars: [], path: filePath };
      return { ...parseAvatarFile(text), path: filePath };
    },

    save(avatars: AvatarRecord[]) {
      const file = prepareAvatarFile(avatars);
      return writes.add(() => writePrivateFileViaTempRename(fs, path, filePath, JSON.stringify(file, null, 2)));
    },
  };
}
