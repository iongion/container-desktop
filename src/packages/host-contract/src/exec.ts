// Result of a host command execution — the host/exec kernel type (part of the host-contract leaf).
// Imports nothing internal so any layer (container-client, platform) can consume it.
export interface CommandExecutionResult {
  pid: any;
  code: any;
  success: boolean;
  stdout?: string;
  stderr?: string;
  command?: string;
}
