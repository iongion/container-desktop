import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import type { Wrapper } from "@/env/Types";
import { createLogger } from "@/logger";

const logger = createLogger("shared");

export const DEFAULT_RETRIES_COUNT = 10;

export interface WrapperOpts extends SpawnOptionsWithoutStdio {
  wrapper: Wrapper;
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
