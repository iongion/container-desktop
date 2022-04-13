const logger = require("electron-log");

function createLogger(name) {
  if (process.env.NODE_ENV === "development") {
    return console;
  }
  return logger;
}

module.exports = {
  createLogger,
};
