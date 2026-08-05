import { sha256Text } from "@/ai-system/adapters/sha256";
import type { WorkspaceChangeOrigin } from "@/ai-system/core/workspaceChanges";
import { createWorkspaceChangesPort, type WorkspaceChangesPort } from "@/ai-system/core/workspaceChanges";
import type { ExecuteIsolated, HostEnv } from "@/host-contract/capabilities";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";

const TIMEOUT_MS = 10_000;
const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "windir",
  "PATHEXT",
] as const;

interface GitWorkspaceChangesOptions {
  exec: ExecuteIsolated;
  workspace: IWorkspaceAccess;
  origin: WorkspaceChangeOrigin;
  baseEnv?: HostEnv;
}

function gitEnvironment(baseEnv: HostEnv): Record<string, string> {
  const environment: Record<string, string> = {
    GIT_PAGER: "cat",
    PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_EXTERNAL_DIFF: "",
    GIT_DIFF_OPTS: "",
  };
  for (const key of ENV_ALLOWLIST) {
    const value = baseEnv[key];
    if (typeof value === "string") environment[key] = value;
  }
  return environment;
}

export function createGitWorkspaceChanges(options: GitWorkspaceChangesOptions): WorkspaceChangesPort {
  return createWorkspaceChangesPort({
    origin: options.origin,
    workspaceRoot: () => options.workspace.root(),
    fingerprint: sha256Text,
    untrackedSignature: async (path) => {
      const stat = await options.workspace.stat(path);
      return `${stat.path}:${stat.kind}:${stat.size}:${stat.modifiedMs}`;
    },
    exec: async (workspaceRoot, program, args) => {
      const result = await options.exec(program, [...args], {
        cwd: workspaceRoot,
        env: gitEnvironment(options.baseEnv ?? {}),
        timeout: TIMEOUT_MS,
      });
      return {
        code: typeof result.code === "number" ? result.code : null,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        truncated: false,
      };
    },
  });
}
