// Headless test bootstrap. The container-client layer reads `Command`/`Platform`/`Path`/`FS`/
// `CURRENT_OS_TYPE` as globals that each shell installs from its native ports; wiring them here lets the
// entire connection layer run under plain Node/Vitest. Shared setupFile for the hermetic and live configs.
//
// It deliberately wires only the SAFE globals (Platform/Path/FS are pure-Node reads). It never installs a
// spawning `Command`: hermetic tests install a recording fake (see fakeCommand.ts), and real-engine work runs
// inside a shell over WebDriver (webdriver/specs/, driven by web-app/liveProbes.ts) where the executor is the
// shell's own Rust/Go one.
import { CURRENT_DARWIN_MAJOR, CURRENT_OS_TYPE, FS, Path, Platform } from "@/__tests__/setup/nodeTestHost";

const g = globalThis as unknown as Record<string, unknown>;
g.Platform = Platform;
g.Path = Path;
g.FS = FS;
g.CURRENT_OS_TYPE = CURRENT_OS_TYPE;
g.CURRENT_DARWIN_MAJOR = CURRENT_DARWIN_MAJOR;
process.env.APP_PATH ??= process.cwd();
