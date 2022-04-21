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

function del(key) {
  return electronConfig.delete(key);
}

module.exports = {
  getPath,
  get,
  set,
  del,
  window: () => electronConfig.window()
};
