// Per-OS download matrix for the website.
//
// This is intentionally tiny: the actual list of platforms, arches and package
// formats lives in support/build-matrix.cjs — the same module electron-builder
// reads to decide what to build — so the download cards can never drift from
// what CI actually publishes. Add a format there and it shows up here for free.
//
// site.version tracks package.json, so links always match the current release
// (tasks.py rebuilds the site on release). The Windows Microsoft Store wrapper
// is version-pinned inside build-matrix.cjs because it is uploaded by hand and
// may intentionally lag the generated assets.
import { createRequire } from "node:module";
import site from "./site.js";

const require = createRequire(import.meta.url);
const { downloadModel } = require("../../support/build-matrix.cjs");

export default downloadModel(site.version, { microsoftStore: site.microsoftStore });
