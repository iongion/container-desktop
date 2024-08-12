export async function pruneSystem(currentApi) {
  return await currentApi.engine.pruneSystem();
}

export async function resetSystem(currentApi) {
  return await currentApi.engine.resetSystem();
}

export async function getSystemInfo(currentApi) {
  return await currentApi.engine.getSystemInfo();
}

export function createActions(context, { ipcRenderer, userConfiguration, osType, version, environment }) {
  // Do not access the context at creation - it is lazy
  return {
    pruneSystem: (...rest) => pruneSystem(context.getCurrentApi(), ...(rest as [])),
    resetSystem: (...rest) => pruneSystem(context.getCurrentApi(), ...(rest as [])),
    getSystemInfo: (...rest) => getSystemInfo(context.getCurrentApi(), ...(rest as []))
  };
}

export default {
  pruneSystem,
  resetSystem,
  getSystemInfo,
  createActions
};
