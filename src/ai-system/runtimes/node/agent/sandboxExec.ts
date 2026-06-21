// Production executor for the diagnostic-agent sandbox. MAIN-ONLY.
//
// The sandbox (sandbox.ts) owns ALL policy — classification, the scrubbed env, the fixed cwd and the
// hard timeout. This module is the thin process glue it calls: an args-array spawn with NO shell and
// a WHOLESALE replacement env (the scrubbed allowlist the sandbox built). We deliberately do NOT use
// Command.Execute here: exec_launcher_async force-merges the full process.env into the child, which
// would re-introduce the very secrets the sandbox scrubbed. wrapSpawnAsync gives us the same
// flatpak-aware, args-array spawn WITHOUT that merge — the child sees only opts.env.

import type { CommandExecutionResult } from "@/env/Types";
import { createLogger } from "@/logger";
import { wrapSpawnAsync } from "@/platform/node-executor";
import type { SandboxExec } from "./sandbox";

const logger = createLogger("ai.sandbox");

// Hard in-flight collection cap so a runaway command cannot exhaust memory before the sandbox applies
// its (post-hoc) output cap. Generous vs the sandbox cap; output is truncated either way.
const MAX_COLLECT_BYTES = 512 * 1024;

export function createSandboxExec(): SandboxExec {
  return (program, args, opts) =>
    new Promise<CommandExecutionResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let child: any;

      const finish = (code: number | null, extraError?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (extraError) {
          stderr += (stderr ? "\n" : "") + extraError;
        }
        resolve({ pid: child?.pid, code, success: code === 0, stdout, stderr, command: program });
      };

      const timer = setTimeout(() => {
        try {
          child?.kill("SIGTERM");
        } catch (error: any) {
          logger.warn(program, "sandbox timeout kill failed", error?.message ?? error);
        }
        finish(null, `Command timed out after ${opts.timeout}ms`);
      }, opts.timeout);
      timer.unref?.();

      // shell:false + args array + a wholesale (scrubbed) env. No detached/wrapper — the model can set none of these.
      wrapSpawnAsync(program, args, { cwd: opts.cwd, env: opts.env, shell: false } as any)
        .then((spawned) => {
          child = spawned;
          const onData = (which: "out" | "err") => (data: any) => {
            if (which === "out") {
              if (stdout.length < MAX_COLLECT_BYTES) {
                stdout += data;
              } else {
                finish(null, "output exceeded the collection cap");
              }
            } else if (stderr.length < MAX_COLLECT_BYTES) {
              stderr += data;
            }
          };
          child.stdout?.setEncoding("utf8");
          child.stderr?.setEncoding("utf8");
          child.stdout?.on("data", onData("out"));
          child.stderr?.on("data", onData("err"));
          child.on("error", (error: any) => finish(null, String(error?.message ?? error)));
          child.on("exit", (code: number | null) => finish(code));
        })
        .catch((error: any) => finish(null, String(error?.message ?? error)));
    });
}
