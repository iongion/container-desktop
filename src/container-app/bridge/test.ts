// project
import { ActionContext, ActionsEnvironment } from "@/container-app/bridge/types";
import { adapters, api } from "@/container-client";
import { findProgramVersion, getAvailablePodmanMachines, parseProgramVersion } from "@/detector";
import { createLogger } from "@/logger";

// locals
const { Podman, Docker } = adapters;
const logger = await createLogger("bridge.test");

export async function testProgramReachability(adapters, osType, opts?: any) {
  const result: any = { success: false, program: undefined, details: undefined, scopes: undefined };
  const { adapter, engine, controller, program } = opts;
  logger.debug(adapter, engine, "Testing if program is reachable", opts);
  const testController =
    controller?.path && [Podman.ENGINE_PODMAN_VIRTUALIZED, Docker.ENGINE_DOCKER_VIRTUALIZED].includes(engine);
  if (testController) {
    try {
      const version = await findProgramVersion(controller.path, { osType });
      if (!version) {
        logger.error(adapter, engine, "[C] Program test failed - no version", controller);
        throw new Error("Test failed - no version");
      }
      if (version) {
        let scopes = [];
        try {
          scopes = await getAvailablePodmanMachines(controller.path);
        } catch (error: any) {
          logger.error(adapter, engine, "[C] Unable to list podman machines", error.message, error.stack);
        }
        result.success = true;
        result.details = `Program has been found - version ${version}`;
        result.scopes = scopes;
        result.program = {
          path: controller.path,
          version
        };
      }
    } catch (error: any) {
      logger.error(adapter, engine, "[C] Testing if program is reachable - failed during detection", error.message);
      result.details = "Program detection error";
    }
  } else if (program.path) {
    try {
      // Always instantiate engines for tests
      const adapterInstance = adapters.find((it) => it.ADAPTER === adapter);
      const adapterEngine = adapterInstance.createEngineByName(engine);
      if (!adapterEngine) {
        result.success = false;
        result.details = "Adapter engine is not accessible";
      } else {
        const check = await adapterEngine.runScopedCommand(program.path, ["--version"], {
          scope: controller?.scope
        });
        logger.debug(adapter, engine, "[P] Testing if program is reachable - completed", check);
        const version = check.success ? parseProgramVersion(check.stdout) : undefined;
        if (check.success && version) {
          result.success = true;
          result.details = `Program has been found - version ${version}`;
          result.program = {
            path: program.path,
            version
          };
        }
      }
    } catch (error: any) {
      logger.error(adapter, engine, "[P] Testing if program is reachable - failed during detection", error.message);
      result.details = "Program detection error";
    }
  }
  return result;
}

export async function testApiReachability(adapters, osType, opts?: any) {
  const result: any = { success: false, details: undefined };
  const { adapter, engine } = opts;
  logger.debug("Testing if api is reachable", opts);
  // Always instantiate engines for tests
  const adapterInstance = adapters.find((it) => it.ADAPTER === adapter);
  const adapterEngine = adapterInstance.createEngineByName(engine);
  if (!adapterEngine) {
    result.success = false;
    result.details = "Adapter engine is not accessible";
  } else {
    const config = api.getApiConfig(opts.baseURL, opts.connectionString);
    const driver = await adapterEngine.getApiDriver(config);
    try {
      const response = await driver.request({ method: "GET", url: "/_ping" });
      result.success = response?.data === "OK";
      result.details = response?.data || "Api reached";
    } catch (error: any) {
      result.details = "API is not reachable - start manually or connect";
      logger.error(
        "Reachability test failed",
        opts,
        error.message,
        error.response ? { code: error.response.status, statusText: error.response.statusText } : ""
      );
    }
    logger.debug("[P] Testing if api is reachable - completed", result.success);
  }
  return result;
}

export async function test(adapters, osType, opts?: any) {
  let result: any = { success: false };
  const { subject, payload } = opts || {};
  switch (subject) {
    case "reachability.api":
      result = testApiReachability(adapters, osType, payload);
      break;
    case "reachability.program":
      result = testProgramReachability(adapters, osType, payload);
      break;
    default:
      result.details = `Unable to perform unknown test subject "${subject}"`;
      break;
  }
  return result;
}

export function createActions(context: ActionContext, { osType }: ActionsEnvironment) {
  // Do not access the context at creation - it is lazy
  return {
    test: (...rest) => test(context.getAdapters(), osType, ...(rest as [])),
    testProgramReachability: (...rest) => testProgramReachability(context.getAdapters(), osType, ...(rest as [])),
    testApiReachability: (...rest) => testApiReachability(context.getAdapters(), osType, ...(rest as []))
  };
}

export default {
  test,
  testProgramReachability,
  testApiReachability,
  createActions
};
