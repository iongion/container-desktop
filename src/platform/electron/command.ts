// Thin facade over the focused modules in `./exec/`. This file owns ONLY the assembled `Command`
// object and re-exports the public surface, so every import of `@/platform/electron/command` resolves the
// same symbols. All implementation lives in the single-responsibility modules: process-utils, api-driver,
// commander, ssh-transport, wsl-relay, proxy-request. (`ICommand`/`SSHHost` are ambient globals — no import.)

import { type ChildProcessWithoutNullStreams, spawnSync } from "node:child_process";
import type { AxiosRequestConfig } from "axios";
import type { Connection, EngineConnectorSettings, ServiceOpts } from "@/env/Types";
import { createNodeJSApiDriver } from "./exec/api-driver";
import { exec_launcher_async, exec_service, exec_streaming } from "./exec/commander";
import { killProcess, type WrapperOpts } from "./exec/process-utils";
import { proxyRequest } from "./exec/proxy-request";
import { startSSHConnection } from "./exec/ssh-transport";
import { stopRelayServer } from "./exec/wsl-relay";

export const Command: ICommand = {
  async CreateNodeJSApiDriver(config: AxiosRequestConfig<any>) {
    return createNodeJSApiDriver(config);
  },

  async Spawn(command: string, args?: readonly string[], options?: any) {
    return spawnSync(command, args, options);
  },

  async Kill(proc: ChildProcessWithoutNullStreams, signal?: NodeJS.Signals | number) {
    return killProcess(proc, signal);
  },

  async Execute(launcher: string, args: string[], opts?: WrapperOpts) {
    return await exec_launcher_async(launcher, args, opts);
  },

  async ExecuteAsBackgroundService(launcher: string, args: string[], opts?: Partial<ServiceOpts>) {
    return await exec_service(launcher, args, opts);
  },

  async ExecuteStreaming(launcher: string, args: string[], opts?: Partial<ServiceOpts>) {
    return await exec_streaming(launcher, args, opts);
  },

  async StartSSHConnection(host: SSHHost, opts?: Partial<ServiceOpts>) {
    return await startSSHConnection(host, opts);
  },

  async StopConnectionServices(connection_id: string, settings: EngineConnectorSettings): Promise<void> {
    return await stopRelayServer(connection_id);
  },

  async ProxyRequest(request: Partial<AxiosRequestConfig>, connection: Connection, context?: any) {
    return await proxyRequest(request, connection, context);
  },
};

export {
  applyProxyRequestDefaults,
  createNodeJSApiDriver,
  getProxyRequestRoute,
  type ProxyRequestRoute,
} from "./exec/api-driver";
export {
  applyWrapper,
  exec_launcher,
  exec_launcher_async,
  exec_service,
  wrap_process,
  wrapSpawnAsync,
} from "./exec/commander";
export { killProcess, type WrapperOpts } from "./exec/process-utils";
export { resetConnectionCaches as __resetConnectionCaches } from "./exec/proxy-request";
export { proxyRequestToSSHConnection } from "./exec/ssh-transport";
export { proxyRequestToWSLDistribution, WSLRelayServer, withWSLRelayServer } from "./exec/wsl-relay";
