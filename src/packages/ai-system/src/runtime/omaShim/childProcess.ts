// OMA imports spawn through optional built-in tools. App runs inject host-driven tools instead; fail loudly if
// a node-only OMA path ever reaches this browser-safe link stub.
export function spawn(...args: unknown[]): never {
  void args;
  throw new Error(
    "omaShim/childProcess.spawn: shell/process tools are disabled in the webview build (OMA built-in node tools " +
      "are default-deny; inject host-driven customTools instead)",
  );
}

export default { spawn };
