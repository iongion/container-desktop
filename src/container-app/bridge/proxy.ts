// vendors
import { createLogger } from "@/logger";
// locals
const logger = createLogger("bridge.proxy");

export async function proxyHTTPRequest(currentApi, proxyRequest?: any) {
  let result = {
    ok: false,
    data: undefined,
    headers: [],
    status: 500,
    statusText: "API request error"
  };
  const { request, baseURL, socketPath, engine, adapter, scope } = proxyRequest;
  try {
    const driver = await currentApi.engine.getApiDriver({
      baseURL,
      socketPath
    });
    logger.debug("Proxying request", request);
    const response = await driver.request(request);
    result = {
      ok: response.status >= 200 && response.status < 300,
      data: response.data,
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    };
  } catch (error: any) {
    if (error.response) {
      result = {
        ok: false,
        data: error.response.data,
        headers: error.response.headers,
        status: error.response.status,
        statusText: error.response.statusText
      };
    } else {
      result.statusText = error.message || "API request error";
    }
  }
  return {
    result: result,
    success: result.ok,
    warnings: []
  };
}

export function createActions(context) {
  return {
    proxyHTTPRequest: (...rest) => proxyHTTPRequest(context.getCurrentApi(), ...(rest as []))
  };
}

export default {
  proxyHTTPRequest,
  createActions
};
