const dummyFunction = async (context, options) => {
  return {};
};

function createActions(context, { ipcRenderer, userConfiguration, osType, version, environment }) {
  // Do not access the context at creation - it is lazy
  return {
    dummyFunction: (...rest) => dummyFunction(context.getCurrentApi(), ...rest)
  };
}

module.exports = {
  dummyFunction,
  createActions
};
