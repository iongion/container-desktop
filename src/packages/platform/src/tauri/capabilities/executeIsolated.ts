import type { CommandExecutionResult } from "@/host-contract/exec";
// Tauri ExecuteIsolated port — the env-isolating variant of the ONE exec command. It calls command_execute with
// isolate=true (the Rust side then clears the inherited env and applies ONLY opts.env) plus the hard timeout —
// NOT a second Rust command. The caller (the AI sandbox policy) still owns ALL policy (classification, the
// scrubbed env, the fixed cwd, the timeout); this is the thin process glue, mirroring
// platform/electron/capabilities/executeIsolated.ts. (isolate=false — the default — is ICommand.Execute, which
// layers onto the inherited env and would re-introduce the very secrets the caller scrubbed.)

import type { ExecuteIsolated } from "@/host-contract/capabilities";

import type { TauriInvoke } from "./invoke";

export function createTauriExecuteIsolated(invoke: TauriInvoke): ExecuteIsolated {
  return (program, args, opts) =>
    invoke<CommandExecutionResult>("command_execute", {
      launcher: program,
      args,
      cwd: opts.cwd,
      env: opts.env,
      isolate: true,
      timeoutMs: opts.timeout,
    });
}
