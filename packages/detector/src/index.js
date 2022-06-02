// module
const detector = require("./detector");
const shared = require("./shared");

module.exports = {
  ...detector,
  ...shared
};
module.exports.default = module.exports;
