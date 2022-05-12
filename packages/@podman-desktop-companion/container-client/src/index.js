// module
const adapters = require("./adapters");
const api = require("./api");
const application = require("./application");
const bridge = require("./bridge");
const configuration = require("./configuration");
const constants = require("./constants");
const detector = require("./detector");
const shared = require("./shared");

module.exports = {
  api,
  adapters,
  application,
  detector,
  bridge,
  configuration,
  constants,
  shared
};
