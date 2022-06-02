// node
import * as os from "os";
// vendors
// project
import { UserConfiguration } from "@podman-desktop-companion/container-config";
import { createLogger } from "@podman-desktop-companion/logger";
// locals
const logger = createLogger("app.configuration");
export const osType = os.type();
// runtime configuration when bundled
export const runtime = {
  environment: "imports.meta.env.APP_ENV",
  version: "imports.meta.env.PROJECT_VERSION"
};

export const environment = runtime.environment;
export const version = runtime.version;

export const userConfiguration = new UserConfiguration(runtime.version, runtime.environment, osType);

logger.debug("Electron app configuration", runtime);
