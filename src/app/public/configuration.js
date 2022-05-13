// node
const os = require("os");
// vendors
// require("fix-path")();
const merge = require("lodash.merge");
// project
const { UserConfiguration } = require("@podman-desktop-companion/container-config");
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const logger = createLogger("app.configuration");
const osType = os.type();
// runtime configuration when bundled
const runtime = require("./runtime.json");
// shared multi-process configuration
const electron = {
  version: process.env.ELECTRON_WEBPACK_APP_PROJECT_VERSION,
  environment: process.env.ELECTRON_WEBPACK_APP_ENV
};
const react = {
  version: process.env.REACT_APP_PROJECT_VERSION,
  environment: process.env.REACT_APP_ENV
};
const env = {
  version: process.env.APP_PROJECT_VERSION,
  environment: process.env.APP_ENV
};
const current = merge({}, runtime, electron, react, env);
logger.debug("Electron app configuration", current.environment, current.version, {
  env: {
    electron,
    react,
    env,
    runtime
  }
});
module.exports = {
  osType,
  version: current.version,
  environment: current.environment,
  userConfiguration: new UserConfiguration(current.version, current.environment, osType)
};
