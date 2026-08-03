import type { GlobalUserSettingsOptions } from "@/container-client/userSettings";

export function updateLogLevel(options: Partial<GlobalUserSettingsOptions>): string | undefined {
  return options.logging?.level;
}
