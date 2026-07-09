// adapters/swarm.ts — the renderer-facing Docker Swarm adapter.
//
// Thin, host-bound face over the pure swarm-rest owner. The renderer uses THIS for every swarm op
// (lists, inspect, write, cluster secrets/configs). The Docker dialect does NOT import this — it calls
// swarm-rest directly with host.getApiDriver() (see dialects/docker.ts) to avoid the Application cycle.
//
// Gate is the CAPABILITY, not the API shape: Apple Container is apiSurface "docker" but has
// extensions.swarm:false, and the repo contract is "capabilities gate real-vs-no-op". So every method
// short-circuits when the host's swarm capability is off — WITHOUT touching the driver.

import type {
  HostAddress,
  NodeUpdateOptions,
  SwarmConfig,
  SwarmConfigCreateOptions,
  SwarmInfo,
  SwarmInitOptions,
  SwarmLeaveOptions,
  SwarmNode,
  SwarmSecret,
  SwarmSecretCreateOptions,
  SwarmService,
  SwarmStack,
  SwarmTask,
} from "@/env/Types";
import { ResourceAdapter } from "./shared";
import { parseHostAddresses } from "./swarm-net";
import * as swarm from "./swarm-rest";

export class SwarmAdapter extends ResourceAdapter {
  // Capability gate (real-vs-no-op) — NOT apiSurface. Apple Container is "docker" but swarm:false.
  private get enabled(): boolean {
    return this.host?.capabilities?.extensions?.swarm === true;
  }

  // lifecycle / probe
  async inspect(): Promise<SwarmInfo | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    return swarm.swarmInspect(await this.driver());
  }
  async init(opts?: SwarmInitOptions): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return swarm.swarmInit(await this.driver(), opts);
  }
  async leave(opts?: SwarmLeaveOptions): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return swarm.swarmLeave(await this.driver(), opts);
  }

  // Candidate `--advertise-addr` values — the IPv4 interfaces of the SELECTED connection's host, obtained by
  // running `ip -o -4 addr show scope global` on that host (native/SSH/WSL) via the same scoped-command path
  // getSystemInfo uses. Best-effort: returns [] when `ip` is unavailable (e.g. Docker Desktop's VM) so the
  // init drawer degrades to free-text.
  async listAdvertiseCandidates(): Promise<HostAddress[]> {
    if (!this.enabled) {
      return [];
    }
    try {
      const settings = await this.host.getSettings();
      const args = ["-4", "-o", "addr", "show", "scope", "global"];
      const result = this.host.isScoped()
        ? await this.host.runScopeCommand("ip", args, settings.controller?.scope || "", settings)
        : await this.host.runHostCommand("ip", args, settings);
      return result?.success ? parseHostAddresses(result.stdout) : [];
    } catch {
      return [];
    }
  }

  // services
  async listServices(): Promise<SwarmService[]> {
    if (!this.enabled) {
      return [];
    }
    return swarm.listServices(await this.driver());
  }
  async getService(id: string): Promise<SwarmService | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    return swarm.getService(await this.driver(), id);
  }
  async createService(spec: Record<string, unknown>): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return swarm.createService(await this.driver(), spec);
  }
  async scaleService(id: string, replicas: number): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return swarm.scaleService(await this.driver(), id, replicas);
  }
  async updateService(id: string, patch: Record<string, unknown>): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return swarm.updateService(await this.driver(), id, patch);
  }
  async removeService(id: string): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return swarm.removeService(await this.driver(), id);
  }

  // tasks / stacks
  async listTasks(serviceId?: string): Promise<SwarmTask[]> {
    if (!this.enabled) {
      return [];
    }
    return swarm.listTasks(await this.driver(), serviceId);
  }
  async listStacks(): Promise<SwarmStack[]> {
    if (!this.enabled) {
      return [];
    }
    return swarm.listStacks(await this.driver());
  }

  // nodes
  async listNodes(): Promise<SwarmNode[]> {
    if (!this.enabled) {
      return [];
    }
    return swarm.listNodes(await this.driver());
  }
  async getNode(id: string): Promise<SwarmNode | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    return swarm.getNode(await this.driver(), id);
  }
  async updateNode(id: string, opts: NodeUpdateOptions): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return swarm.updateNode(await this.driver(), id, opts);
  }
  async removeNode(id: string, force = false): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return swarm.removeNode(await this.driver(), id, force);
  }

  // cluster secrets / configs
  async listSecrets(): Promise<SwarmSecret[]> {
    if (!this.enabled) {
      return [];
    }
    return swarm.listSecrets(await this.driver());
  }
  async getSecret(id: string): Promise<SwarmSecret | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    return swarm.getSecret(await this.driver(), id);
  }
  async createSecret(opts: SwarmSecretCreateOptions): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return swarm.createSecret(await this.driver(), opts);
  }
  async removeSecret(id: string): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return swarm.removeSecret(await this.driver(), id);
  }
  async listConfigs(): Promise<SwarmConfig[]> {
    if (!this.enabled) {
      return [];
    }
    return swarm.listConfigs(await this.driver());
  }
  async getConfig(id: string): Promise<SwarmConfig | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    return swarm.getConfig(await this.driver(), id);
  }
  async createConfig(opts: SwarmConfigCreateOptions): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return swarm.createConfig(await this.driver(), opts);
  }
  async removeConfig(id: string): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    return swarm.removeConfig(await this.driver(), id);
  }
}
