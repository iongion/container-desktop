// node
// vendors
const { v4: uuidv4 } = require("uuid");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
// locals
const DEFAULT_MAX_EXECUTION_TIME = 60000;

class RPCWorkerGateway {
  constructor(factory) {
    this.factory = factory;
    this.invocations = {};
    this.worker = null;
    this.keepAlive = false;
    this.logger = createLogger("rpc.gateway");
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
    const guid = `rpc-${uuidv4()}`;
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
    const invocation = {
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
        new Promise(async (resolve, reject) => {
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
          const worker = await this.getWorker();
          try {
            this.logger.debug(guid, "Worker request - message delivery started", message);
            worker.postMessage(message);
          } catch (error) {
            this.logger.error(guid, "Worker request - message delivery error", error.message, error.stack);
          }
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

function createWorkerGateway(factory) {
  const gateway = new RPCWorkerGateway(factory);
  return gateway;
}

async function createWorkerClient(scope, onMessage, id) {
  async function scopeMessageListener(event) {
    // message context
    const message = event.data;
    const logger = createLogger(id || "rpc.worker");
    const ctx = {
      logger,
      message,
      done: (fault, result) => {
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
    } catch (error) {
      logger.error(message.guid, "Message processing exception", error);
      ctx.done({ message: error.message, stack: error.stack });
    }
  }
  function scopeErrorListener(evt) {
    logger.error(message.guid, "Worker client error", evt);
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

module.exports = {
  createWorkerGateway,
  createWorkerClient
};
