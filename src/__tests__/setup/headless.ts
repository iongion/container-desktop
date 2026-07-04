// Headless test bootstrap. The container-client layer reads `Command`/`Platform`/`Path`/`FS`/
// `CURRENT_OS_TYPE` as globals that the Electron main/preload assign at startup (see
// platform/electron/main.ts). Wiring them here lets the entire connection layer run under plain
// Node/Vitest — no Electron. This is the shared setupFile for both the hermetic and live configs.
//
// It deliberately wires only the SAFE globals (Platform/Path/FS are pure-Node reads). It does NOT
// install a spawning `Command`: hermetic tests install a recording fake (see fakeCommand.ts), and
// live tests opt into the real executor via installRealCommand().
import { CURRENT_DARWIN_MAJOR, CURRENT_OS_TYPE, FS, Path, Platform } from "@/platform/electron/host";

const g = globalThis as unknown as Record<string, unknown>;
g.Platform = Platform;
g.Path = Path;
g.FS = FS;
g.CURRENT_OS_TYPE = CURRENT_OS_TYPE;
g.CURRENT_DARWIN_MAJOR = CURRENT_DARWIN_MAJOR;
process.env.APP_PATH ??= process.cwd();

/** Live tests only: wire the real Node executor as the global `Command` (spawns real processes). */
export async function installRealCommand() {
  const { Command } = await import("@/platform/electron/command");
  (globalThis as unknown as Record<string, unknown>).Command = Command;
  return Command;
}
