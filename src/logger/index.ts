// node
// vendors
import logger from "electron-log";
// project
import userSettings from "@/user-settings";
// locals
const loggers: any[] = [];

export function createLogger(name) {
  // This flag is useful to avoid missing logging origin(file and number) when developing
  if (process.env.NODE_ENV !== "production") {
    return console;
  }
  const level = getLevel();
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

export function getLevel() {
  return userSettings.get("logging.level", "error");
}

export function setLevel(level) {
  setLoggerInstanceLevel(logger, level);
  loggers.forEach((instance) => setLoggerInstanceLevel(instance, level));
  userSettings.set("logging.level", level);
  return level;
}
