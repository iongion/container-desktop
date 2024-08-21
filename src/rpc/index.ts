// node
// vendors
import { v4 } from "uuid";
// project
import { createLogger } from "@/logger";
// locals
export const DEFAULT_MAX_EXECUTION_TIME = 60000;

const logger = await createLogger("rpc.gateway");

export class RPCWorkerGateway {
  private factory: any;
  private invocations: any;
  private worker: any;
  private keepAlive: boolean;
  private logger: any;

  constructor(factory) {
    this.factory = factory;
    this.invocations = {};
    this.worker = null;
    this.keepAlive = false;
    this.logger = logger;
  }
  async getWorker() {
    if (!this.worker) {
      this.worker = await this.factory();
      this.worker.addEventListener("error", (evt) => {
        this.logger.error("Worker response - gateway error", evt);
      });
      this.worker.addEventListener("message", async (evt) => {
        const response = evt.data;
        this.logger.debug("Worker response - gateway received message", response);
        const invocation = this.invocations[response.guid];
        if (invocation) {
          await invocation.clear(true);
          if (this.keepAlive) {
            this.logger.debug("Worker complete - keep alive");
          } else {
            this.logger.debug("Worker complete - terminate");
            this.worker.terminate();
            this.worker = undefined;
          }
          // clear the stack
          if (response.type === "rpc.response.result") {
            invocation.done(null, response.payload);
          } else {
            invocation.done(null, {
              result: response.payload,
              success: false,
              warnings: []
            });
          }
        } else {
          this.logger.error("No invocation for current response", response);
        }
      });
    }
    return this.worker;
  }
  async createInvocation({ payload, context }, opts) {
    const guid = `rpc-${v4()}`;
    const maxExecutionTime = opts?.maxExecutionTime || DEFAULT_MAX_EXECUTION_TIME;
    const message = {
      guid,
      type: "rpc.request",
      created: new Date().getTime() / 1000,
      payload,
      context,
      // timeout control
      maxExecutionTime
    };
    const invocation: any = {
      message,
      handled: false,
      timeout: undefined,
      clear: async (markHandled) => {
        this.logger.warn(guid, "Worker request - timeout clearing");
        clearTimeout(invocation.timeout);
        if (markHandled) {
          invocation.handled = markHandled;
        }
        delete this.invocations[guid];
        invocation.timeout = undefined;
      },
      send: () =>
        new Promise((resolve, reject) => {
          this.invocations[guid] = invocation;
          this.logger.debug(guid, "Worker request - timeout monitor started");
          // register timeout monitor
          invocation.done = (err, res) => {
            if (err) {
              reject(err);
            } else {
              resolve(res);
            }
          };
          invocation.timeout = setTimeout(async () => {
            await invocation.clear();
            if (invocation.handled) {
              this.logger.debug(guid, "Worker request timed-out - skip handling(already handled)");
            } else {
              this.logger.error(guid, "Worker request timed-out - marking as handled(notifying timeout)");
              invocation.handled = true;
              const worker = await this.getWorker();
              if (worker) {
                this.logger.error(guid, "Worker request timed-out - terminating");
                worker.terminate();
                this.worker = undefined;
              }
              reject(new Error("Worker communication timeout"));
            }
          }, maxExecutionTime);
          // deliver message and wait for reply
          return this.getWorker().then((worker) => {
            try {
              this.logger.debug(guid, "Worker request - message delivery started", message);
              worker.postMessage(message);
            } catch (error: any) {
              this.logger.error(guid, "Worker request - message delivery error", error.message, error.stack);
            }
          });
        })
    };
    return invocation;
  }
  async invoke(payload, context, opts) {
    this.keepAlive = !!opts?.keepAlive;
    const invocation = await this.createInvocation({ payload, context }, opts);
    return await invocation.send();
  }
}

export function createWorkerGateway(factory) {
  const gateway = new RPCWorkerGateway(factory);
  return gateway;
}

export async function createWorkerClient(scope, onMessage, id) {
  const logger = await createLogger(id || "rpc.worker");
  async function scopeMessageListener(event) {
    // message context
    const message = event.data;
    const ctx = {
      logger,
      message,
      done: (fault: any, result?: any) => {
        if (fault) {
          scope.postMessage({
            type: "rpc.response.fault",
            guid: message.guid,
            payload: fault
          });
        } else {
          scope.postMessage({
            type: "rpc.response.result",
            guid: message.guid,
            payload: result
          });
        }
      }
    };
    logger.debug(message.guid, "Worker processing started", message);
    try {
      await onMessage(ctx, message);
    } catch (error: any) {
      logger.error(message.guid, "Message processing exception", error);
      ctx.done({ message: error.message, stack: error.stack });
    }
  }
  function scopeErrorListener(evt) {
    logger.error(id, "Worker client error", evt);
  }
  scope.addEventListener("message", scopeMessageListener);
  scope.addEventListener("error", scopeErrorListener);
  return {
    release: () => {
      scope.removeEventListener("message", scopeMessageListener);
      scope.removeEventListener("error", scopeErrorListener);
    }
  };
}
