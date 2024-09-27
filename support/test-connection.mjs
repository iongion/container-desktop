// vendors
import axios from "axios";
import adapter from "axios/lib/adapters/http.js";

export function createApiDriver(config) {
  const driver = axios.create({
    ...config,
    adapter
  });
  return driver;
}

const driver = createApiDriver({
  // socketPath: "\\\\.\\pipe\\wcontainer-desktop-wsl-relay",
  baseURL: "http://localhost:8080"
});
let response = await driver.get("/_ping");
console.log(response.data);
response = await driver.get("/containers/json");
console.log(response.data);
