// module
const adapters = require("./adapters");
const api = require("./api");
const application = require("./application");
const configuration = require("./configuration");
const constants = require("./constants");
const detector = require("./detector");
const shared = require("./shared");

module.exports = {
  api,
  detector,
  adapters,
  shared,
  configuration,
  application,
  constants
};
