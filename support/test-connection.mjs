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
  socketPath: "\\\\.\\pipe\\docker_engine",
  baseURL: "http://d"
});
const response = await driver.get("/v4.0.0/libpod/pods/json");
console.log(response.data);
