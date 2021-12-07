// vendors
// project
import { findAPI } from "../Api";
import { CURRENT_ENVIRONMENT } from "../Environment";

const env = CURRENT_ENVIRONMENT;
export const api = findAPI(env);
if (api === undefined) {
  console.error("No such API environment", env);
  throw new Error("API instance is mandatory");
}
export const withPending = async (state: any, operation: any) => {
  let result = {
    success: false,
    body: "",
    warnings: []
  };
  state.setPending(true);
  try {
    result = await operation();
  } catch (error: any) {
    result = {
      ...result,
      body: error?.response?.data || error.message
    };
    console.error("Pending operation error", result, error);
    state.setPending(false);
    // if (error?.message.indexOf("connect ECONNREFUSED") !== -1) {
    //   console.debug("Connection broken");
    //   state.setRunning(false);
    // }
    console.debug("Forwarding error", { result, error });
    throw error;
  } finally {
    state.setPending(false);
  }
  return result;
};
