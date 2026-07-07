import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import type { Wrapper } from "@/env/Types";
import { createLogger } from "@/platform/logger";

const logger = createLogger("platform.process");

export const DEFAULT_RETRIES_COUNT = 10;

export interface WrapperOpts extends SpawnOptionsWithoutStdio {
  wrapper?: Wrapper;
  proxyEnv?: boolean;
  // Isolated exec (the sandbox): the child sees ONLY `env` — never process.env or the proxy creds. This is the
  // wholesale-env-replacement guarantee ICommand.Execute (which merges) deliberately does NOT give.
  isolate?: boolean;
  // Terminate + resolve once collected stdout OR stderr reaches this many bytes (sandbox memory-exhaustion guard).
  maxCollectBytes?: number;
  // Data piped to the child's stdin (non-detached execs only — the detached path uses stdio:"ignore", no stdin).
  // Keeps secret-bearing input (registry `login --password-stdin`, `cat > ca.crt`) OUT of argv and logs.
  input?: string;
}

export function killProcess(proc: ChildProcessWithoutNullStreams, signal?: NodeJS.Signals | number) {
  if (proc.stdin) {
    try {
      proc.stdin.end();
      proc.stdin.destroy();
    } catch (error: any) {
      logger.error(proc.pid, "Error closing stdin", error);
    }
  }
  if (proc.stdout) {
    try {
      proc.stdout.removeAllListeners();
      proc.stdout.destroy();
    } catch (error: any) {
      logger.error(proc.pid, "Error closing stdout", error);
    }
  }
  if (proc.stderr) {
    try {
      proc.stderr.removeAllListeners();
      proc.stderr.destroy();
    } catch (error: any) {
      logger.error(proc.pid, "Error closing stderr", error);
    }
  }
  try {
    logger.debug(proc.pid, "Killing process");
    proc.kill(signal);
  } catch (error: any) {
    logger.error(proc.pid, "Error killing process", error);
  }
  try {
    logger.debug(proc.pid, "Unref process");
    proc.unref();
  } catch (error: any) {
    logger.error(proc.pid, "Unref process failed", error);
  }
}
