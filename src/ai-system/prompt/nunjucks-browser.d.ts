// Type shim for the nunjucks BROWSER build (node_modules/nunjucks/browser/nunjucks.js). @types/nunjucks
// only declares the main "nunjucks" entry; the browser bundle is functionally identical for the API we
// use (Environment + renderString) and pulls in NO Node dependency, so we mirror the upstream types via
// the CommonJS export form. This keeps the prompt module compile-time safe in every bundle.
declare module "nunjucks/browser/nunjucks.js" {
  import nunjucks = require("nunjucks");
  export = nunjucks;
}
