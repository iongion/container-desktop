import type { CommandExecutionResult } from "@/host-contract/exec";
import type { Connection } from "./connection";
import type { Program } from "./engine";
import type { OperatingSystem } from "./os";

export interface SpawnedProcess {
  pid: any;
  code: any;
  success: boolean;
  stdout?: string;
  stderr?: string;
  command?: any;
  kill: (signal?: NodeJS.Signals | number) => void;
  unref: () => void;
}

export interface ServiceOpts {
  onStatusCheck?: ({ retries, maxRetries }: { retries: number; maxRetries: number }) => void;
  onSpawn?: ({ process, child }: { process: CommandExecutionResult; child: SpawnedProcess }) => void;
  checkStatus: (process: any) => Promise<boolean>;
  retry?: { count: number; wait: number };
  cwd?: string;
  env?: any;
  proxyEnv?: boolean;
}

export enum StartupStatus {
  STARTED = "started",
  STOPPED = "stopped",
  RUNNING = "running", // Already running
  ERROR = "error",
}

export interface ApiDriverConfig {
  baseURL: string;
  headers: Partial<Record<string, string>>;
  socketPath?: string | null;
  timeout?: number;
  scope?: string;
  responseType?: any;
}

// Extra per-exec options threaded to the underlying process — DISTINCT from EngineConnectorSettings so it never
// clobbers the settings arg. `input` is piped to the child's stdin (registry `login --password-stdin`,
// `cat > ca.crt`) so secret-bearing input never appears in argv or logs. Honored by all three exec backends.
export interface HostExecOptions {
  input?: string;
}

export interface ProgramOutput {
  stdout?: string | null;
  stderr?: string | null;
}

export interface FindProgramOptions {
  connection: Connection;
  program: Program;
  insideScope: boolean;
}

export interface ProgramOptions {
  osType: OperatingSystem;
  wrapper?: Wrapper;
}

export interface SubscriptionOptions {
  since?: string;
  until?: string;
  filters?: { [key: string]: string };
  reports?: { type: string; action: string }[];
  attachTimeoutMs?: number;
}

export interface ApplicationEnvironment {
  osType: OperatingSystem;
  version: string;
  environment: string;
  provisioned?: boolean;
  running?: boolean;
  messageBus: IMessageBus;
}

export interface ApiStartOptions {
  logLevel?: string;
}

export interface RunnerStarterOptions extends ApiStartOptions {
  path?: string;
  args?: string[];
  proxyEnv?: boolean;
}

export interface RunnerStopperOptions {
  path?: string;
  args?: string[];
}

export interface Wrapper {
  launcher: string;
  args: string[];
}
