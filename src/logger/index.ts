// node
// vendors
import logger from "electron-log";
// project
import { UserConfiguration } from "@/container-config";
// locals
const loggers: any[] = [];

export async function createLogger(name) {
  // This flag is useful to avoid missing logging origin(file and number) when developing
  if (import.meta.env.ENVIRONMENT !== "production") {
    return console;
  }
  const level = await getLevel();
  let instance = logger;
  if (name) {
    instance = logger.create(name);
    loggers.push(instance);
  }
  setLoggerInstanceLevel(instance, level);
  return instance;
}

function setLoggerInstanceLevel(instance, level) {
  if (instance?.transports?.file) {
    instance.transports.file.level = level;
  }
  if (instance?.transports?.console) {
    instance.transports.console.level = level;
  }
}

export async function getLevel() {
  const configuration = UserConfiguration.getInstance();
  const logging = await configuration.getKey<any>("logging");
  return logging?.level ?? "error";
}

export async function setLevel(level) {
  setLoggerInstanceLevel(logger, level);
  loggers.forEach((instance) => setLoggerInstanceLevel(instance, level));
  const configuration = UserConfiguration.getInstance();
  await configuration.setKey("logging", { level });
  return level;
}
