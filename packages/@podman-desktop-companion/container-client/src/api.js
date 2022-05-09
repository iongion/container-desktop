// vendors
const axios = require("axios");
// project
const { exec_launcher, exec_service, exec_launcher_sync } = require("@podman-desktop-companion/executor");
const { axiosConfigToCURL } = require("@podman-desktop-companion/utils");
const { createLogger } = require("@podman-desktop-companion/logger");
// module
// locals
const logger = createLogger("container-client.api");

function createApiDriver(config) {
  const driver = axios.create({
    ...config,
    adapter: require("axios/lib/adapters/http")
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

function getApiConfig(baseURL, socketPath) {
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

class Runner {
  constructor(client) {
    this.client = client;
    this.nativeApiStarterProcess = undefined;
    this.nativeApiStarterProcessChild = undefined;
    this.logger = createLogger("container-client.api.Runner");
  }

  // API connectivity and startup
  async startApi(opts, starter) {
    this.logger.debug("Starting API - guard configuration");
    const configured = await this.client.isApiAvailable();
    if (!configured) {
      return { success: false, details: "API is not configured" };
    }
    this.logger.debug("Starting API - check if already running");
    const running = await this.client.isApiRunning();
    if (running.success) {
      this.logger.debug("Starting API - already running(returning)");
      return true;
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
    const client = await exec_service(clientOpts);
    return new Promise((resolve, reject) => {
      client.on("ready", async ({ process, child }) => {
        try {
          this.logger.debug("System service start read", process);
          this.nativeApiStarterProcess = process;
          this.nativeApiStarterProcessChild = child;
          resolve(true);
        } catch (error) {
          this.logger.error("System service ready error", error.message, error.stack);
          reject(error);
        }
      });
      client.on("error", (info) => {
        this.logger.error("Process error", info);
        reject(new Error("Unable to start system service"));
      });
    });
  }
  async stopApi(opts, stopper) {
    this.logger.debug("Stopping API");
    let flag = false;
    if (stopper) {
      const result = await exec_launcher_sync(stopper.path, stopper.args);
      flag = result.success;
    } else {
      this.logger.warn("Stopping API - no stopper specified");
    }
    if (this.nativeApiStarterProcessChild) {
      this.logger.debug("Stopping API - sending SIGTERM to child", this.nativeApiStarterProcess);
      try {
        this.nativeApiStarterProcessChild.kill("SIGTERM");
        flag = true;
      } catch (error) {
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

module.exports = {
  getApiConfig,
  createApiDriver,
  Runner
};
