import type { CommandExecutionResult } from "@/host-contract/exec";
// Electron ExecuteIsolated port — the env-scrubbed, shell-less, hard-timeout executor. MAIN-ONLY.
//
// This is NOT a second executor. It is the ONE exec primitive (exec_launcher_async) invoked with isolate=true —
// a WHOLESALE env (exactly opts.env, never process.env / proxy), a hard timeout, and an output cap. The caller
// (the AI sandbox policy) still owns classification, the scrubbed env, the fixed cwd and the timeout; this is the
// thin adapter onto the port. window.Command.Execute can't be used: it layers onto the inherited process env
// (+ proxy), re-introducing the very secrets the caller scrubbed — which is exactly what isolate=true prevents.

import type { ExecuteIsolated } from "@/host-contract/capabilities";
import { exec_launcher_async } from "@/platform/electron/command";

// Hard in-flight collection cap so a runaway command cannot exhaust memory before the caller applies its
// (post-hoc) output cap. Generous vs that cap; output is truncated either way.
const MAX_COLLECT_BYTES = 512 * 1024;

export function createNodeExecuteIsolated(): ExecuteIsolated {
  return (program, args, opts): Promise<CommandExecutionResult> =>
    exec_launcher_async(program, args, {
      cwd: opts.cwd,
      env: opts.env,
      isolate: true,
      timeout: opts.timeout,
      maxCollectBytes: MAX_COLLECT_BYTES,
    });
}
