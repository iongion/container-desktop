// vendors
const electronConfig = require("electron-cfg");
// project
// locals

function getPath() {
  return electronConfig.resolveUserDataPath(".");
}

function get(key, defaultValue) {
  return electronConfig.get(key, defaultValue);
}

function set(key, value) {
  return electronConfig.set(key, value);
}

module.exports = {
  getPath,
  get,
  set,
  window: () => electronConfig.window()
};
