// node
// vendors
import { createLogger } from "@/logger";
// project
// locals
const logger = createLogger("worker");

self.onmessage = async function (e) {
  const msg = e.data;
  let response;
  try {
    if (!msg || !msg.guid || msg.type !== "rpc.request" || !msg.payload) {
      logger.error("Invalid request", msg);
      return;
    }
    const req = msg.payload;
    const ctx = msg.context;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { invoker } = require(ctx.workerPath) as any;
    // logger.debug("Invocation start", req.method, req.params);
    const result = await invoker.invoke(req.method, req.params, msg.context);
    response = {
      success: true,
      guid: msg.guid,
      type: "rpc.response",
      created: new Date().getTime() / 1000,
      payload: result
    };
    // logger.debug("Invocation done", response, req);
  } catch (error: any) {
    logger.error("Invocation error", error);
    response = {
      success: false,
      guid: msg.guid,
      type: "rpc.response",
      created: new Date().getTime() / 1000,
      payload: {
        error: error.message
      }
    };
  }
  self.postMessage(response);
};
