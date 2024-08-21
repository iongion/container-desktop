// vendors
import axios from "axios";

// project
import { createLogger } from "@/logger";
import { Command } from "@/platform/node";
import { axiosConfigToCURL } from "@/utils";
import adapter from "axios/lib/adapters/http";

// module
// locals
// eslint-disable-next-line @typescript-eslint/no-require-imports
const logger = await createLogger("container-client.api");

export function createApiDriver(config) {
  const driver = axios.create({
    ...config,
    adapter
  });
  // Configure http client logging
  // Add a request interceptor
  driver.interceptors.request.use(
    function (config) {
      logger.debug("[container-client] HTTP request", axiosConfigToCURL(config));
      return config;
    },
    function (error) {
      logger.error("[container-client] HTTP request error", error.message, error.stack);
      return Promise.reject(error);
    }
  );
  // Add a response interceptor
  driver.interceptors.response.use(
    function (response) {
      logger.debug("[container-client] HTTP response", { status: response.status, statusText: response.statusText });
      return response;
    },
    function (error) {
      logger.error(
        "[container-client] HTTP response error",
        error.message,
        error.response ? { code: error.response.status, statusText: error.response.statusText } : ""
      );
      return Promise.reject(error);
    }
  );
  return driver;
}

export function getApiConfig(baseURL: string, socketPath: string) {
  console.debug("Constructing config", { baseURL, socketPath });
  const config = {
    timeout: 60000,
    socketPath: socketPath ? socketPath.replace("unix://", "") : socketPath,
    baseURL,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    }
  };
  // logger.debug("API configuration", config);
  return config;
}

const runnerLogger = await createLogger("container-client.api.Runner");

export class Runner {
  protected client: any;
  protected nativeApiStarterProcess: any;
  protected nativeApiStarterProcessChild: any;
  protected logger: any;
  constructor(client) {
    this.client = client;
    this.nativeApiStarterProcess = undefined;
    this.nativeApiStarterProcessChild = undefined;
    this.logger = runnerLogger;
  }

  // API connectivity and startup
  async startApi(opts?: any, starter?: any) {
    this.logger.debug("Starting API - guard configuration");
    const configured = await this.client.isApiAvailable();
    if (!configured) {
      this.logger.error("Starting API - API is not configured");
      return false;
    }
    const settings = await this.client.getCurrentSettings();
    const availability = await this.client.getAvailability(settings);
    if (!availability.program) {
      this.logger.error("Starting API - start skipped when no program is available", availability);
      return false;
    }
    this.logger.debug("Starting API - check if already running using availability", availability);
    if (availability.api) {
      this.logger.debug("Starting API - already running(returning)");
      return true;
    }
    this.logger.debug("Starting API - invoking starter", starter);
    if (!starter.path) {
      this.logger.error("Starting API - Starter program not configured");
      return false;
    }
    const clientOpts = {
      retry: { count: 10, wait: 5000 },
      checkStatus: async () => {
        const result = await this.client.isApiRunning();
        return result.success;
      },
      programPath: starter.path,
      programArgs: starter.args,
      ...(opts || {})
    };
    this.logger.debug("System service start requested", clientOpts);
    try {
      const client = await Command.StartService(clientOpts);
      const started = await new Promise((resolve, reject) => {
        let rejected = false;
        client.on("ready", async ({ process, child }) => {
          try {
            this.nativeApiStarterProcess = process;
            this.nativeApiStarterProcessChild = child;
            this.logger.debug("System service start ready", process);
            resolve(true);
          } catch (error: any) {
            if (rejected) {
              this.logger.warn("System service start - already rejected");
            } else {
              rejected = true;
              reject(error);
            }
          }
        });
        client.on("error", (info) => {
          this.logger.error("System service start - process error", info);
          if (rejected) {
            this.logger.warn("System service start - already rejected");
          } else {
            rejected = true;
            reject(new Error("Unable to start system service"));
          }
        });
      });
      return started;
    } catch (error: any) {
      this.logger.error("System service start failed", error.message);
    }
    return false;
  }
  async stopApi(opts, stopper) {
    this.logger.debug("Stopping API - begin");
    let flag = false;
    if (stopper) {
      const result: any = await Command.Execute(stopper.path, stopper.args);
      flag = result.success;
    } else {
      this.logger.warn("Stopping API - no stopper specified");
    }
    if (this.nativeApiStarterProcessChild) {
      this.logger.debug("Stopping API - sending SIGTERM to child", this.nativeApiStarterProcess);
      try {
        this.nativeApiStarterProcessChild.kill("SIGTERM");
        flag = true;
      } catch (error: any) {
        this.logger.warn("Stopping API - failed sending SIGTERM to child", error.message);
      }
      this.nativeApiStarterProcessChild.unref();
      this.nativeApiStarterProcessChild = null;
    } else {
      this.logger.debug("No native starter process child found - nothing to stop");
      flag = true;
    }
    return flag;
  }
}

export default {
  getApiConfig,
  createApiDriver,
  createApiAdapter: () => adapter,
  Runner
};
