// module
const { createApiDriver } = require("./api");
const { Detector } = require("./detector");
const Docker = require("./clients/docker");
const Podman = require("./clients/podman");
const Registry = require("./registry");

module.exports = {
  createApiDriver,
  Detector,
  Clients: {
    Docker,
    Podman
  },
  Registry
};
