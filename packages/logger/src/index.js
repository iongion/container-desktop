// vendors
const logger = require("electron-log");
// project
const userSettings = require("@podman-desktop-companion/user-settings");
// locals

function createLogger(name) {
  if (process.env.NODE_ENV === "development") {
    return console;
  }
  return logger;
}

function getLevel() {
  return userSettings.get("logging.level", "debug");
}

function setLevel(level) {
  return userSettings.get("logging.level", level);
}

module.exports = {
  createLogger,
  getLevel,
  setLevel
};
