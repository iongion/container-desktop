import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ENVIRONMENT, NODE_ENV, PORT, PROJECT_CODE, PROJECT_HOME, projectVersion, TARGET } from "@/cli/lib/paths";

// Replaces invoke's `ctx.run`. Commands echo the line, inherit stdio and propagate the child's
// exit code; `runEnv` additionally reproduces tasks.py `run_env` — it sources nvm (unless in CI or
// on Windows) so the .nvmrc Node runs the yarn scripts, matching the previous behavior.

export type EnvOverrides = Record<string, string | undefined>;

/** The base environment tasks.py `get_env` injected into every child process. */
export function getEnv(): Record<string, string> {
  return {
    BROWSER: "none",
    PORT: String(PORT),
    PROJECT_HOME,
    PROJECT_CODE,
    PROJECT_VERSION: projectVersion(),
    NODE_ENV,
    TARGET,
    PUBLIC_URL: ".",
    ENVIRONMENT,
    APP_PROJECT_VERSION: projectVersion(),
  };
}

function shellFor(): string | boolean {
  return process.platform === "win32" ? true : "/bin/bash";
}

const SHELL_SAFE = /^[\w@%+=:,./-]+$/;
/** POSIX shell quoting (shlex.quote equivalent) for interpolating values into `run`/`capture`. */
export function shellQuote(value: string): string {
  const text = String(value);
  if (text === "") {
    return "''";
  }
  if (SHELL_SAFE.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", "'\"'\"'")}'`;
}

/** Run a command from an argv array (no shell), inheriting stdio; throws on a non-zero exit unless
 * `allowFailure`. Mirrors subprocess.run(args, check=True). */
export function spawnArgs(
  command: string,
  args: string[],
  options: { allowFailure?: boolean; cwd?: string } = {},
): number {
  console.log(`+ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", cwd: options.cwd || PROJECT_HOME });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} failed (exit ${result.status ?? `signal ${result.signal}`})`);
  }
  return result.status ?? 1;
}

/** Run a shell command, inheriting stdio; throws on a non-zero exit. */
export function run(cmd: string, env?: EnvOverrides, cwd: string = PROJECT_HOME): void {
  console.log(`+ ${cmd}`);
  const childEnv = { ...process.env, ...(env || {}) };
  const result = spawnSync(cmd, { stdio: "inherit", env: childEnv, cwd, shell: shellFor() });
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status ?? `signal ${result.signal}`}): ${cmd}`);
  }
}

/** Run a yarn/tooling command with the project env, sourcing nvm the way tasks.py `run_env` did. */
export function runEnv(cmd: string, env?: EnvOverrides, cwd: string = PROJECT_HOME): void {
  const childEnv = { ...process.env, ...getEnv(), ...(env || {}) };
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  const nvmSh = path.join(nvmDir, "nvm.sh");
  const useNvm = process.env.CI !== "true" && process.platform !== "win32" && fs.existsSync(nvmSh);

  let finalCmd = cmd;
  if (useNvm) {
    const prefix = fs.existsSync(path.join(cwd, ".nvmrc")) ? `. "${nvmSh}" && nvm use && ` : `. "${nvmSh}" && `;
    finalCmd = prefix + cmd;
  }

  console.log(`+ ${cmd}`);
  const result = spawnSync(finalCmd, { stdio: "inherit", env: childEnv, cwd, shell: shellFor() });
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status ?? `signal ${result.signal}`}): ${cmd}`);
  }
}

/** Run a command and capture stdout. When `allowFailure`, returns the result instead of throwing. */
export function capture(
  cmd: string,
  options: { cwd?: string; allowFailure?: boolean } = {},
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(cmd, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    cwd: options.cwd || PROJECT_HOME,
    shell: shellFor(),
    encoding: "utf8",
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${cmd}${stderr ? `\n${stderr}` : ""}`);
  }
  return { status: result.status, stdout, stderr };
}
