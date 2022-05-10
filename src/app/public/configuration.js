// node
const os = require("os");
// vendors
require("fix-path")();
// project
const { UserConfiguration } = require("@podman-desktop-companion/container-client").configuration;
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const logger = createLogger("app.configuration");
const osType = os.type();
let version = process.env.ELECTRON_WEBPACK_APP_PROJECT_VERSION || process.env.REACT_APP_PROJECT_VERSION;
let environment = process.env.ELECTRON_WEBPACK_APP_ENV || process.env.REACT_APP_ENV;
// shared multi-process configuration
logger.debug(
  "Electron app configuration",
  { osType, version, environment },
  {
    env: {
      electron: {
        version: process.env.ELECTRON_WEBPACK_APP_PROJECT_VERSION,
        environment: process.env.ELECTRON_WEBPACK_APP_ENV
      },
      react: {
        version: process.env.REACT_APP_PROJECT_VERSION,
        environment: process.env.REACT_APP_ENV
      }
    }
  }
);
module.exports = {
  osType,
  version,
  environment,
  userConfiguration: new UserConfiguration(version, environment, osType)
};
