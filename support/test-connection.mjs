// vendors
import axios from "axios";
import adapter from "axios/lib/adapters/http.js";

export function createApiDriver(config) {
  const driver = axios.create({
    ...config,
    adapter
  });
  // Configure http client logging
  // Add a request interceptor
  driver.interceptors.request.use(
    function (config) {
      console.debug("[container-client] HTTP request", config);
      return config;
    },
    function (error) {
      console.error("[container-client] HTTP request error", error.message, error.stack);
      return Promise.reject(error);
    }
  );
  // Add a response interceptor
  driver.interceptors.response.use(
    function (response) {
      console.debug("[container-client] HTTP response", { status: response.status, statusText: response.statusText });
      return response;
    },
    function (error) {
      console.error("[container-client] HTTP response error", error.message, error.response ? { code: error.response.status, statusText: error.response.statusText } : "");
      return Promise.reject(error);
    }
  );
  return driver;
}

const driver = createApiDriver({
  socketPath: "\\\\.\\pipe\\docker_engine",
  baseURL: "http://d"
});
const response = await driver.get("/v4.0.0/libpod/pods/json");
console.log(response.data);
