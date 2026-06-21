// Pure helpers for the electron-log file adapter: LOCAL-ONLY hardening + size-based rotation. Kept free
// of electron / electron-log imports so the NEVER-cloud guarantee and the rotation policy are unit-testable
// under plain Node (the adapter itself imports electron and can't load in Vitest).

import fs from "node:fs";
import path from "node:path";

// The active file's Nth rotated sibling: container-desktop.log → container-desktop.1.log, …
export function archivePathFor(activePath: string, index: number): string {
  const dir = path.dirname(activePath);
  const ext = path.extname(activePath);
  const base = path.basename(activePath, ext);
  return path.join(dir, `${base}.${index}${ext}`);
}

// Size-based rotation that keeps `maxFiles` archives (oldest dropped). fs is injectable so the policy is
// unit-testable without disk, and it is best-effort — the logging path must never throw.
export function rotateArchives(activePath: string, maxFiles: number, fsImpl: typeof fs = fs): void {
  try {
    const keep = Math.max(1, Math.floor(maxFiles));
    const oldest = archivePathFor(activePath, keep);
    if (fsImpl.existsSync(oldest)) {
      fsImpl.rmSync(oldest, { force: true });
    }
    for (let i = keep - 1; i >= 1; i--) {
      const from = archivePathFor(activePath, i);
      if (fsImpl.existsSync(from)) {
        fsImpl.renameSync(from, archivePathFor(activePath, i + 1));
      }
    }
    if (fsImpl.existsSync(activePath)) {
      fsImpl.renameSync(activePath, archivePathFor(activePath, 1));
    }
  } catch {
    // best-effort: a rotation failure must not break logging
  }
}
