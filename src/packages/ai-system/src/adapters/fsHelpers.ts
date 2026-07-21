// Small, node-free helpers over the app's existing IFileSystem + IPath ports, shared by the AI runtime file
// stores (permissions / knowledge). They add the two conveniences the raw ports don't: read-or-null (a missing
// file reads back as null) and private-write-ensuring-the-parent-dir. Both shells pass their platform IFileSystem
// verbatim (Electron main -> platform/electron/host FS; Tauri webview -> window.FS) — no bespoke FS abstraction.

import type { IFileSystem, IPath } from "@/host-contract/fs";

// Read a text file, or `null` if it does not exist. A present-but-unreadable file REJECTS — callers (the AI
// permissions store) treat that as fail-closed, distinct from a missing file.
export async function readTextFileOrNull(fs: IFileSystem, filePath: string): Promise<string | null> {
  if (!(await fs.isFilePresent(filePath))) {
    return null;
  }
  return fs.readTextFile(filePath);
}

// Write a PRIVATE (0600 on the Node impl) text file, creating its parent directory first. The AI stores hold
// the user's allow/reject rules + knowledge — never world-readable.
export async function writePrivateFileEnsuringDir(
  fs: IFileSystem,
  path: IPath,
  filePath: string,
  text: string,
): Promise<void> {
  await fs.mkdir(await path.dirname(filePath), { recursive: true });
  await fs.writePrivateTextFile(filePath, text);
}

// Crash-safe private write: write a sibling temp file, then rename() it onto the target. The rename() is the
// atomic step on POSIX — a crash mid-write leaves the previous file intact, never a torn/partial one.
export async function writePrivateFileViaTempRename(
  fs: IFileSystem,
  path: IPath,
  filePath: string,
  text: string,
): Promise<void> {
  const directory = await path.dirname(filePath);
  const name = await path.basename(filePath);
  const tempPath = await path.join(directory, `${name}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writePrivateTextFile(tempPath, text);
  await fs.rename(tempPath, filePath);
}
