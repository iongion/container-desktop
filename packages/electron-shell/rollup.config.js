import path from "path";
import externals from "rollup-plugin-node-externals";
import replace from "@rollup/plugin-replace";
import ts from "rollup-plugin-ts";

const plugins = [
  externals({
    deps: true,
    devDeps: true
  }),
  replace({
    preventAssignment: true,
    values: {
      "imports.meta.env.APP_ENV": process.env.APP_ENV,
      "imports.meta.env.PROJECT_VERSION": process.env.PROJECT_VERSION
    }
  }),
  ts({
    tsconfig: path.join(__dirname, "tsconfig.json")
  })
];

const modules = [
  {
    input: "src/configuration.ts",
    output: {
      file: "build/configuration.js",
      format: "cjs",
      sourcemap: "inline"
    },
    plugins
  },
  {
    input: "src/renderer.ts",
    output: {
      file: "build/renderer.js",
      format: "cjs",
      sourcemap: "inline"
    },
    plugins
  },
  {
    input: "src/preload.ts",
    output: {
      file: "build/preload.js",
      format: "cjs",
      sourcemap: "inline"
    },
    plugins
  },
  {
    input: "src/worker.ts",
    output: {
      file: "build/worker.js",
      format: "cjs",
      sourcemap: "inline",
      exports: "default"
    },
    plugins
  }
];

export default modules;
