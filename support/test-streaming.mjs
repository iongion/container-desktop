import axios from "axios";
import httpAdapter from "axios/lib/adapters/http.js";
import http from "http";

export function createApiDriver() {
  const httpAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 10,
    timeout: 30000
  });
  const driver = axios.create({
    adapter: httpAdapter,
    httpAgent,
    baseURL: "http://d"
    // socketPath: "\\\\.\\pipe\\podman-machine-default"
    // socketPath: "/run/user/1000/podman/podman.sock",
    // socketPath: "/var/run/docker.sock"
  });
  return driver;
}

const driver = createApiDriver();
console.debug(">> PING");
let response = await driver.get("/_ping");
console.debug("<< PING", response.data);
console.debug(">> EVENTS STREAM");
response = await driver.get("/events", { responseType: "stream" });
response.data.pipe(process.stdout);
console.debug("<< EVENTS STREAM", response.data);
