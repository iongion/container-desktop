#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const grayMatterEnginesPath = path.join(projectRoot, "node_modules", "gray-matter", "lib", "engines.js");

function patchGrayMatterYamlEngine() {
  if (!existsSync(grayMatterEnginesPath)) {
    return;
  }

  const source = readFileSync(grayMatterEnginesPath, "utf8");
  if (source.includes("const loadYaml = yaml.load || yaml.safeLoad;")) {
    return;
  }

  const patched = source
    .replace("const engines = exports = module.exports;", [
      "const engines = exports = module.exports;",
      "const loadYaml = yaml.load || yaml.safeLoad;",
      "const dumpYaml = yaml.dump || yaml.safeDump;",
    ].join("\n"))
    .replace("parse: yaml.safeLoad.bind(yaml),", "parse: loadYaml.bind(yaml),")
    .replace("stringify: yaml.safeDump.bind(yaml)", "stringify: dumpYaml.bind(yaml)");

  if (patched === source) {
    throw new Error(`Unable to patch ${grayMatterEnginesPath}`);
  }

  writeFileSync(grayMatterEnginesPath, patched);
  console.log("Patched gray-matter YAML engine for js-yaml 4 compatibility");
}

patchGrayMatterYamlEngine();
