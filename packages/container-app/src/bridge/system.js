async function pruneSystem(currentApi) {
  return await currentApi.engine.pruneSystem();
}

async function resetSystem(currentApi) {
  return await currentApi.engine.resetSystem();
}

async function getSystemInfo(currentApi) {
  return await currentApi.engine.getSystemInfo();
}

function createActions(context, { ipcRenderer, userConfiguration, osType, version, environment }) {
  // Do not access the context at creation - it is lazy
  return {
    pruneSystem: (...rest) => pruneSystem(context.getCurrentApi(), ...rest),
    resetSystem: (...rest) => pruneSystem(context.getCurrentApi(), ...rest),
    getSystemInfo: (...rest) => getSystemInfo(context.getCurrentApi(), ...rest)
  };
}

module.exports = {
  pruneSystem,
  resetSystem,
  getSystemInfo,
  createActions
};
