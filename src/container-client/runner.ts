import { AbstractClientEngine } from "@/container-client/runtimes/abstract/base";
import { ApiStartOptions, EngineConnectorSettings, ILogger, RunnerStarterOptions, RunnerStopperOptions } from "@/env/Types";
import { createLogger } from "@/logger";

export class Runner {
  protected client: AbstractClientEngine;
  protected nativeApiStarterProcess: any;
  protected nativeApiStarterProcessChild: any;
  protected logger!: ILogger;
  protected started: boolean = false;

  constructor(client: AbstractClientEngine) {
    this.client = client;
    this.nativeApiStarterProcess = undefined;
    this.nativeApiStarterProcessChild = undefined;
  }

  // API connectivity and startup
  async startApi(opts?: ApiStartOptions, starter?: RunnerStarterOptions) {
    this.started = true;
    this.logger = createLogger("container-client.api.Runner");
    this.logger.debug(">> Starting API - guard configuration");
    if (!starter?.path) {
      this.logger.error("<< Starting API - Starter program not configured");
      return false;
    }
    const clientOpts = {
      retry: { count: 10, wait: 5000 },
      checkStatus: async () => {
        this.logger.debug(">> Starting API - Checking API status - checking if running");
        const result = await this.client.isApiRunning();
        return result.success;
      },
      programPath: starter.path,
      programArgs: starter.args,
      ...(opts || {})
    };
    try {
      this.logger.debug(">> Starting API - System service start requested", clientOpts);
      let rejected = false;
      const started = await new Promise<boolean>((resolve, reject) => {
        Command.StartService(clientOpts)
          .then(async (client) => {
            client.on("ready", async ({ process, child }) => {
              try {
                this.nativeApiStarterProcess = process;
                this.nativeApiStarterProcessChild = child;
                this.logger.debug(">> Starting API - System service start ready", { process, child });
                resolve(true);
              } catch (error: any) {
                if (rejected) {
                  this.logger.warn(">> Starting API - System service start - already rejected");
                } else {
                  rejected = true;
                  reject(error);
                }
              }
            });
            client.on("error", (info) => {
              this.logger.error(">> Starting API - System service start - process error", info);
              if (rejected) {
                this.logger.warn(">> Starting API - System service start - already rejected");
              } else {
                rejected = true;
                reject(new Error("Unable to start service"));
              }
            });
          })
          .catch(reject);
      });
      return started;
    } catch (error: any) {
      this.logger.error("<< Starting API - System service start failed", error.message);
    } finally {
      this.logger.debug("<< Starting API - System service start request completed");
    }
    return false;
  }

  async stopApi(customSettings?: EngineConnectorSettings, stopper?: RunnerStopperOptions) {
    if (!this.started) {
      return;
    }
    this.logger.debug(">> Stopping API - begin");
    let flag = false;
    if (stopper && stopper.path) {
      const result: any = await Command.Execute(stopper.path, stopper.args || []);
      flag = result.success;
    } else {
      this.logger.warn("Stopping API - no stopper specified");
    }
    if (this.nativeApiStarterProcessChild) {
      try {
        this.nativeApiStarterProcessChild.kill("SIGTERM");
        this.nativeApiStarterProcessChild = null;
        flag = true;
      } catch (error: any) {
        this.logger.warn("Stopping API - failed", error.message);
      }
    } else {
      this.logger.debug("No native starter process child found - nothing to stop");
      flag = true;
    }
    this.logger.debug("<< Stopping API - complete", { stopped: flag });
    return flag;
  }
}
