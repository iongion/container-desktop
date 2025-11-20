import { userConfiguration } from "@/container-client/config";
import type { ILogger } from "@/env/Types";

const loggers: ILogger[] = [];

export function createLogger(name): ILogger {
  return console as ILogger;
}

function setLoggerInstanceLevel(instance, level) { }

export async function getLevel() {
  const logging = await userConfiguration.getKey<any>("logging");
  return logging?.level || "error";
}

export async function setLevel(level) {
  // setLoggerInstanceLevel(logger, level);
  loggers.forEach((instance) => {
    setLoggerInstanceLevel(instance, level);
  });
  await userConfiguration.setKey("logging", { level });
  return level;
}
