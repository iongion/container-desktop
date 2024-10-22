// vendors
import axios from "axios";
import adapter from "axios/lib/adapters/http.js";

export function createApiDriver(config) {
  const driver = axios.create({
    ...config,
    adapter,
  });
  return driver;
}

const driver = createApiDriver({
  socketPath:
    "\\\\.\\pipe\\container-desktop-ssh-relay-host.87a47402-2c35-4522-9508-98bf9e6f3053.docker.virtualized.wsl",
  // socketPath: "\\\\.\\pipe\\container-desktop-test",
  // socketPath: "\\\\wsl.localhost\\Ubuntu-24.04\\run\\docker.sock",
  baseURL: "http://d",
});
let response = await driver.get("/_ping");
console.log(response.data);
response = await driver.get("/containers/json");
console.log(response.data);
