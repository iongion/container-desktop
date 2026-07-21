import type { CommandProxyStreamEvent } from "@/container-client/commandProxyProtocol";
import { createMockCommand } from "@/container-client/mock/MockCommand";
import { isMockMode } from "@/container-client/mock/mode";
import { ActivityBus, wrapCommandForActivity } from "@/platform/activityBus";
import type { ICommand } from "@/platform/contract";
import { createCommandProxyClient, type ProxyChannel } from "./commandProxyClient";
import {
  exec_launcher_async,
  exec_service,
  exec_streaming,
  killProcess,
  type ProcessChannel,
  type ProcessEventMessage,
  spawn_sync,
} from "./exec/commander";
import { startSSHConnection } from "./exec/ssh-transport";

export interface WailsCommandDeps {
  invoke: (command: string, args: Record<string, unknown>) => Promise<any>;
  newProcessChannel: () => ProcessChannel;
  newProxyChannel: () => ProxyChannel;
  osType: string;
  getCommandGlobal?: () => ICommand;
}

// Engine process/exec/proxy. Mirrors src/platform/electron/command.ts: this file owns only the assembled
// Command facade; implementation lives in exec/commander, exec/proxy-request, and exec/ssh-transport.
export function createGoCommand(deps: WailsCommandDeps): ICommand {
  const notImplemented = async (): Promise<never> => {
    throw new Error("CreateNodeJSApiDriver is not implemented in the Wails shell");
  };
  const commandDeps = { invoke: deps.invoke, newChannel: deps.newProcessChannel };
  const proxyRequest = createCommandProxyClient({
    invoke: deps.invoke,
    newChannel: deps.newProxyChannel,
    osType: deps.osType,
  });
  const getCommand = deps.getCommandGlobal ?? (() => (globalThis as any).Command);
  const sshDeps = {
    execute: (launcher: string, args: string[], opts?: { timeout?: number }) =>
      getCommand().Execute(launcher, args, opts),
    executeStreaming: (launcher: string, args: string[], opts?: any) =>
      getCommand().ExecuteStreaming(launcher, args, opts),
    osType: deps.osType,
  };
  return {
    CreateNodeJSApiDriver: notImplemented,
    Spawn: (launcher, args, opts) => spawn_sync(commandDeps, launcher, args, opts),
    Execute: (launcher, args, opts) => exec_launcher_async(commandDeps, launcher, args, opts),
    Kill: (process) => killProcess(commandDeps, process),
    ExecuteAsBackgroundService: (launcher, args, opts) => exec_service(commandDeps, launcher, args, opts),
    ExecuteStreaming: (launcher, args, opts) => exec_streaming(commandDeps, launcher, args, opts),
    StartSSHConnection: (host, opts) => startSSHConnection(sshDeps, host, opts),
    StopConnectionServices: async (connectionId, settings) => {
      const relay = (settings as any)?.api?.connection?.relay ?? "";
      await deps.invoke("proxy_bridge_stop", { key: connectionId }).catch(() => undefined);
      if (relay && relay !== connectionId) {
        await deps.invoke("proxy_bridge_stop", { key: relay }).catch(() => undefined);
      }
    },
    ProxyRequest: proxyRequest,
  };
}

export function createCommand(deps: WailsCommandDeps): ICommand {
  const base = isMockMode() ? createMockCommand() : createGoCommand(deps);
  return wrapCommandForActivity(base);
}

export type { CommandProxyStreamEvent, ProcessEventMessage };
export { ActivityBus };
