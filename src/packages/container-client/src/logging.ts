// Persistence-aware log-level control. The logger leaf (@/logger) is pure (in-memory applyLevel only);
// reading/writing the persisted level belongs where userConfiguration lives — here in container-client.
import { userConfiguration } from "@/container-client/config";
import { applyLevel, getEnvironmentLogLevel } from "@/logger";

export async function getLevel() {
  const environmentLevel = getEnvironmentLogLevel();
  if (environmentLevel) {
    return applyLevel(environmentLevel);
  }
  const logging = await userConfiguration.getKey<any>("logging");
  return applyLevel(logging?.level);
}

export async function setLevel(level: string) {
  const normalized = applyLevel(level);
  await userConfiguration.setKey("logging", { level: normalized });
  return normalized;
}
