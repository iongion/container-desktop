import type { GlobalUserSettingsOptions } from "@/env/Types";

// The level a settings UPDATE should (re)apply, or undefined to leave the running level untouched.
// Only an update that explicitly carries `logging.level` should move it — persisting the wizard
// opt-out or makePrimary's connector-only write must not reset it (the old `|| "warn"` fallback did).
export function updateLogLevel(options: Partial<GlobalUserSettingsOptions>): string | undefined {
  return options.logging?.level;
}
