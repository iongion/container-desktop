// vendors
// project
const { Application } = require("@podman-desktop-companion/container-client").application;
// locals

module.exports = {
  invoker: new Application(process.env.REACT_APP_PROJECT_VERSION, process.env.REACT_APP_ENV)
};
