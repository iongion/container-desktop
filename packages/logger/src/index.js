// node
// vendors
const logger = require("electron-log");
// project
const userSettings = require("@podman-desktop-companion/user-settings");
// locals
const loggers = [];

function createLogger(name) {
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
  instance.transports.file.level = level;
  instance.transports.console.level = level;
}

function getLevel() {
  return userSettings.get("logging.level", "error");
}

function setLevel(level) {
  setLoggerInstanceLevel(logger, level);
  loggers.forEach((instance) => setLoggerInstanceLevel(instance, level));
  userSettings.set("logging.level", level);
  return level;
}

module.exports = {
  createLogger,
  getLevel,
  setLevel
};
