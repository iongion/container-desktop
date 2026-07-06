// Pure helpers for locating CI-built release artifacts (no IO). The Windows CD job builds the
// Microsoft Store package but keeps it OFF the public GitHub release (superseded there by the
// signed installer + portable zip), so it only ever lives inside a run's per-arch Windows upload
// artifact. These helpers pick the right artifact and read a version out of an AppX/MSIX filename;
// the `gh`/filesystem orchestration lives in the command layer.

export interface GhArtifact {
  id?: number;
  name?: string;
  expired?: boolean;
  workflow_run?: { id?: number };
  [key: string]: unknown;
}

export const WINDOWS_ARTIFACT_NAMES: Record<string, string> = {
  x64: "container-desktop-windows-x64",
  arm: "container-desktop-windows-arm",
  arm64: "container-desktop-windows-arm",
};
export const WINDOWS_ARTIFACT_NAME = WINDOWS_ARTIFACT_NAMES.x64;

/** Store package format (both are the same OPC container; the Store accepts either). */
export type StorePackageFormat = "appx" | "msix";

/** Both Windows Store arches, in submission order — the Store listing serves the right one per device. */
export const WINDOWS_STORE_ARCHES = ["x64", "arm64"];

/** Which arches a fetch should pull: the single one requested, or both when none is given. */
export function resolveStoreArches(arch?: string): string[] {
  return arch ? [arch] : [...WINDOWS_STORE_ARCHES];
}

/** Pick the first Store package of `format` from a list of files. Null when that format is absent
 * (each Windows CI artifact carries the .appx, .msix, .exe and .zip side by side). */
export function pickStorePackage(files: string[], format: StorePackageFormat): string | null {
  return files.filter((file) => file.endsWith(`.${format}`)).sort()[0] ?? null;
}

const APPX_VERSION_RE = /-(?:x64|arm64)-(.+?)\.appx$/;
const WINDOWS_STORE_PACKAGE_VERSION_RE = /-(?:x64|arm64)-(.+?)\.(?:appx|msix)$/;

export function windowsArtifactName(arch = "x64"): string {
  const name = WINDOWS_ARTIFACT_NAMES[arch.toLowerCase()];
  if (!name) {
    throw new Error(`unsupported Windows artifact arch: ${arch}`);
  }
  return name;
}

/** Return the newest non-expired artifact named `name`, or null. "Newest" is the highest artifact
 * `id`, so the result never depends on the API's return order. The caller reads
 * `workflow_run.id` off the result to know which run to download. */
export function selectWindowsArtifact(artifacts: GhArtifact[], name?: string, arch = "x64"): GhArtifact | null {
  const resolved = name || windowsArtifactName(arch);
  const candidates = artifacts.filter((artifact) => artifact.name === resolved && !artifact.expired);
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((best, artifact) => ((artifact.id ?? 0) > (best.id ?? 0) ? artifact : best));
}

/** Read the version out of an appx filename, e.g. `container-desktop-x64-5.3.11.appx` -> `5.3.11`.
 * Returns null when the name is not an appx (the `.exe`/`.zip` siblings in the same artifact). */
export function parseAppxVersion(filename: string): string | null {
  const match = APPX_VERSION_RE.exec(String(filename));
  return match ? match[1] : null;
}

/** Read the version out of an AppX/MSIX Store package filename. Returns null when the name is not
 * a Windows Store package. */
export function parseWindowsStorePackageVersion(filename: string): string | null {
  const match = WINDOWS_STORE_PACKAGE_VERSION_RE.exec(String(filename));
  return match ? match[1] : null;
}
