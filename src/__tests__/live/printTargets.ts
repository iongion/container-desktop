// Prints the parsed live targets as JSON so the WebDriver harness can read them without duplicating the
// parser. The specs run under wdio (plain JS), and the target grammar lives in targets.ts — the single source
// of truth, with its own hermetic unit test. `tsx` resolves the @/ aliases from tsconfig, so this stays a
// one-line bridge rather than a second implementation.
//
// Usage: tsx src/__tests__/live/printTargets.ts
import { loadTestTargets } from "./targets";

process.stdout.write(JSON.stringify(loadTestTargets()));
