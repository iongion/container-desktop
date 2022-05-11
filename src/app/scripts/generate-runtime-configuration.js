const fs = require("fs");
const path = require("path");
const root = path.dirname(__dirname);
const runtime = {
  environment: process.env.REACT_APP_ENV || "development",
  version: process.env.REACT_APP_PROJECT_VERSION || "1.0.0-grc"
};
const runtimePath = path.join(root, "public/runtime.json");
fs.writeFileSync(runtimePath, JSON.stringify(runtime, null, 2));
