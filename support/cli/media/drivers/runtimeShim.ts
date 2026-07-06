// esbuild (via tsx) wraps named inner functions with a `__name(fn, "name")` helper it defines at each
// module's top level. When we hand such a transpiled function to page.evaluate / browser.execute it runs
// in the APP's realm — where `__name` was never defined — throwing "ReferenceError: __name is not
// defined" (e.g. freezeUi's inner `hideToasts`, settleOnScreen's `bump`). The capture scripts are TS run
// through tsx, so every backend injects this no-op shim into the page before driving it.
//
// It is injected as a STRING, never a function: a function literal here would itself be rewritten by
// esbuild to reference __name (`globalThis.__name = __name(function… )`) and reintroduce the very bug.
// No trailing semicolon so the same text is valid both as an addInitScript body and a Playwright
// page.evaluate(expression) / WebDriver executeScript string.
export const RUNTIME_NAME_SHIM = "globalThis.__name = globalThis.__name || function (target) { return target; }";
