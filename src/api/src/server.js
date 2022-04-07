// node
// vendors
const express = require("express");
const cors = require("cors");
// project
const {
  getSystemEnvironment,
  startApi,
  getMachines,
  createMachine,
  removeMachine,
  getProgram,
  getApiDriver,
  getApiSocketPath,
  isApiRunning
} = require("@podman-desktop-companion/container-client");
// locals
const main = () => {
  const app = express();
  const port = 8085;
  // middleware
  app.use(express.json());
  app.use(cors());
  // api emulation
  app.get("/v3.0.0/libpod/system/program", async (req, res) => {
    const program = await getProgram(req.query.podman || "podman");
    res.status(200);
    res.set({ "Content-Type": "application/json" });
    res.send(JSON.stringify(program, null, 2));
    res.end();
  });
  app.get("/v3.0.0/libpod/system/running", async (req, res) => {
    const flag = await isApiRunning();
    res.status(200);
    res.set({ "Content-Type": "application/json" });
    res.send(JSON.stringify(flag, null, 2));
    res.end();
  });
  app.post("/v3.0.0/libpod/system/environment", async (req, res) => {
    const environment = await getSystemEnvironment();
    res.status(200);
    res.set({ "Content-Type": "application/json" });
    res.send(JSON.stringify(environment, null, 2));
    res.end();
  });
  app.post("/v3.0.0/libpod/system/api/start", async (req, res) => {
    try {
      const program = await startApi({ http: true });
      res.status(200);
      res.set({ "Content-Type": "application/json" });
      res.send(JSON.stringify(program, null, 2));
    } catch (error) {
      console.error("Unable to start service", error);
      res.status(500);
      res.set({ "Content-Type": "application/json" });
      res.send(JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
    }
    res.end();
  });
  app.get("/v3.0.0/libpod/machines/json", async (req, res) => {
    let response = [];
    try {
      response = await getMachines();
    } catch (error) {
      console.error("Unable to get machines list", error);
    }
    res.status(200);
    res.set({ "Content-Type": "application/json" });
    res.send(JSON.stringify(response, null, 2));
    res.end();
  });
  app.post("/v3.0.0/libpod/machines/create", async (req, res) => {
    console.debug("creating machine", req.body);
    const response = await createMachine(req.body);
    res.status(204);
    res.set({ "Content-Type": "application/json" });
    res.send(JSON.stringify(response, null, 2));
    res.end();
  });
  app.delete("/v3.0.0/libpod/machines/:name", async (req, res) => {
    let response = [];
    try {
      response = await removeMachine(req.params.name, req.query.force === "true");
    } catch (error) {
      console.error("Unable to remove machine", error);
    }
    res.status(204);
    res.set({ "Content-Type": "application/json" });
    res.send(JSON.stringify(response, null, 2));
    res.end();
  });
  app.use(async (req, res, next) => {
    if (req.url.indexOf("favicon.ico") !== -1) {
      next();
      return;
    }
    console.debug("Middleware", req.method, req.url, req.body);
    res.set({
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    const api = getApiDriver();
    // api.interceptors.request.use(requestLogger, requestLogger);
    // api.interceptors.response.use(responseLogger, responseLogger);
    const method = req.method.toLowerCase();
    const serviceUrl = req.url.replace("/v3.0.0/libpod", "");
    const curl = [
      "curl",
      "-iv",
      "-X",
      method.toUpperCase(),
      "--unix-socket",
      getApiSocketPath(),
      `"http://d${req.url}"`,
      "-H",
      '"Content-Type: application/json"'
    ];
    try {
      const result = await api[method](serviceUrl, req.body);
      res.status(result.status);
      res.send(JSON.stringify(result.data, null, 2));
    } catch (error) {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
        if (typeof req.body !== "undefined") {
          curl.push("-d");
          curl.push(`'${JSON.stringify(req.body)}'`);
        }
      }
      const detail = { errno: error.errno, code: error.code, syscall: error.syscall };
      console.error("Request failed", curl.join(" "), "error", error.response, detail);
      if (error.response) {
        res.status(500);
        res.send(JSON.stringify(error.response?.data, null, 2));
      } else {
        res.status(500);
        res.send(JSON.stringify({ cause: "Missing error response", message: error.message, detail }, null, 2));
      }
    }
    res.end();
  });
  // api proxy
  // app.use('/v3.0.0/libpod', createProxyMiddleware({
  //   target: 'http://localhost:8081',
  //   onProxyRes: function (proxyRes, req, res) {
  //     proxyRes.headers['Access-Control-Allow-Origin'] = '*';
  //   },
  //   changeOrigin: true,
  // }));
  // Entry point
  app.listen(port, () => {
    console.debug(`Example app listening at http://localhost:${port}`);
  });
};

if (require.main === module) {
  main();
}
