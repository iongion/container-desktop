import type { GlobalUserSettingsOptions } from "@/env/Types";

export function updateLogLevel(options: Partial<GlobalUserSettingsOptions>): string | undefined {
  return options.logging?.level;
}
