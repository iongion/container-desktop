// adapters/registryTrust.ts — per-connection registry-trust actions (sign in / out), bound to a specific
// connection's host (like RegistriesAdapter). No REST driver: these are config/CLI actions on Application. The
// credential is delivered to the engine over stdin (`--password-stdin`) and never persisted by the app.

import { Application } from "@/container-client/Application";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import type { CommandExecutionResult } from "@/env/Types";

export class RegistryTrustAdapter {
  constructor(private readonly host?: HostClientFacade) {}

  async login(opts: {
    registry: string;
    username: string;
    secret: string;
    insecure?: boolean;
  }): Promise<CommandExecutionResult> {
    return await Application.getInstance().registryLogin({ ...opts, host: this.host });
  }

  async logout(registry: string): Promise<CommandExecutionResult> {
    return await Application.getInstance().registryLogout({ registry, host: this.host });
  }
}
