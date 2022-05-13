// project
const { createApiDriver } = require("@podman-desktop-companion/container-client/src/api");
const { createLogger } = require("@podman-desktop-companion/logger");
const { createWorkerGateway } = require("@podman-desktop-companion/rpc");
// locals
const logger = createLogger("bridge.proxy");

async function proxy(req, ctx, opts) {
  const gateway = createWorkerGateway(() => new Worker("worker.js"));
  // Inject configuration
  ctx.configuration = {
    osType: osType,
    version: version,
    environment: environment
  };
  console.error(">>>>>>>>>>>>>>>>>>>>>>> INVOKE", { req, ctx, opts });
  return await gateway.invoke(req, ctx, opts);
}

async function proxyHTTPRequest(req) {
  const driver = createApiDriver({
    baseURL: req.baseURL,
    socketPath: req.socketPath
  });
  let result;
  try {
    const response = await driver.request({
      method: req.method,
      url: req.url,
      params: req.params,
      data: req.data
    });
    result = {
      ok: response.status >= 200 && response.status <= 300,
      status: response.status,
      statusText: response.statusText,
      data: response.data,
      headers: response.headers
    };
  } catch (error) {
    if (error.response) {
      logger.error("Response error", error.message, error.stack);
      result = {
        ok: false,
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      };
    } else {
      logger.error("Request exception", error.message, error.stack);
      result = {
        ok: false,
        status: 500,
        statusText: "Request exception",
        data: undefined,
        headers: {}
      };
    }
  }
  return {
    result: result,
    success: result.ok,
    warnings: []
  };
}

module.exports = {
  proxy,
  proxyHTTPRequest
};
