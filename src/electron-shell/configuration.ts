// node
import * as os from "os";
// vendors
// project
import { UserConfiguration } from "@/container-config";
import { createLogger } from "@/logger";
// locals
const logger = createLogger("app.configuration");
export const osType = os.type();
// runtime configuration when bundled
export const runtime = {
  environment: import.meta.env.ENVIRONMENT,
  version: import.meta.env.PROJECT_VERSION
};

export const environment = runtime.environment;
export const version = runtime.version;

export const userConfiguration = new UserConfiguration(runtime.version, runtime.environment);

logger.debug("Electron app configuration", runtime);
