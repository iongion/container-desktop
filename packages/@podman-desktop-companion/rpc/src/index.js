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
    this.logger = createLogger("rpc.gateway");
  }
  async getWorker() {
    if (!this.worker) {
      this.worker = await this.factory();
      this.worker.addEventListener("message", (evt) => {
        const response = evt.data;
        const invocation = this.invocations[response.guid];
        if (invocation) {
          invocation.clear(true);
          // clear the stack
          setTimeout(() => {
            if (response.type === "rpc.response.result") {
              invocation.done(null, response.payload);
            } else {
              invocation.done(null, {
                result: response.payload,
                success: false,
                warnings: []
              });
            }
          });
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
      clear: (markHandled) => {
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
          this.logger.debug(guid, "Message timeout monitor started");
          // register timeout monitor
          invocation.done = (err, res) => {
            if (err) {
              reject(err);
            } else {
              resolve(res);
            }
          };
          invocation.timeout = setTimeout(() => {
            invocation.clear();
            if (invocation.handled) {
              this.logger.debug(guid, "Message timed-out - skip handling(already handled)");
            } else {
              this.logger.debug(guid, "Message timed-out - marking as handled(notifying timeout)");
              invocation.handled = true;
              reject(new Error("Worker communication timeout"));
            }
          }, maxExecutionTime);
          // deliver message and wait for reply
          const worker = await this.getWorker();
          try {
            this.logger.debug(guid, "Message delivery started", message);
            worker.postMessage(message);
          } catch (error) {
            this.logger.error(guid, "Message post error", error.message, error.stack);
          }
        })
    };
    return invocation;
  }
  async invoke(payload, context, opts) {
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
    try {
      await onMessage(ctx, message);
    } catch (error) {
      logger.error(message.guid, "Message processing exception", error);
      ctx.done({ message: error.message, stack: error.stack });
    }
  }
  scope.addEventListener("message", scopeMessageListener);
  return {
    release: () => {
      scope.removeEventListener("message", scopeMessageListener);
    }
  };
}

module.exports = {
  createWorkerGateway,
  createWorkerClient
};
