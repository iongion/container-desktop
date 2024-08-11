import fs from "node:fs";
import path from "node:path";
const root = path.dirname(__dirname);
const runtime = {
  environment: process.env.ENVIRONMENT || "development",
  version: process.env.PROJECT_VERSION || "1.0.0-grc"
};
const runtimePath = path.join(root, "public/runtime.json");
fs.writeFileSync(runtimePath, JSON.stringify(runtime, null, 2));
