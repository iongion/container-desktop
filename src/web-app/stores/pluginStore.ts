// The Plugins screen's state: pi's configured packages joined with what they contribute, plus the progress
// of whatever install or update is running. The session's bridge client lives in the coding-agent store, so
// this one reads it there rather than owning a second connection.
import { create } from "zustand";

import { buildPluginRows, type PluginRow, parsePluginSource } from "@/ai-system/core/pluginCatalog";
import { createLogger } from "@/logger";
import type { BridgeEvent, PluginScope } from "@/pi-bridge/protocol";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

const logger = createLogger("web-app.pluginStore");

export interface PluginState {
  rows: PluginRow[];
  // One flag for the whole table: pi's package manager has a single progress slot, so two installs at once
  // would interleave their output with no way to tell which line belongs to which.
  busy: boolean;
  progress?: { source: string; message: string };
  // The sources a check found a newer version for. Empty until the user asks, because answering it costs a
  // registry round trip per package.
  updatable: string[];
  error?: string;
  refresh(): Promise<void>;
  install(source: string, scope: PluginScope): Promise<void>;
  remove(source: string, scope: PluginScope): Promise<void>;
  update(source?: string): Promise<void>;
  checkUpdates(): Promise<void>;
  setEnabled(source: string, enabled: boolean, scope: PluginScope): Promise<void>;
  applyBridgeEvent(event: BridgeEvent): void;
  // Subscribes to the session's plugin events and does a first read. Returns the unsubscribe.
  attach(): () => void;
}

export function emptyPluginState(): Pick<PluginState, "rows" | "busy" | "updatable"> & {
  progress?: undefined;
  error?: undefined;
} {
  return { rows: [], busy: false, updatable: [], progress: undefined, error: undefined };
}

function client() {
  return useCodingAgentStore.getState().client;
}

export const usePluginStore = create<PluginState>()((set, get) => ({
  ...emptyPluginState(),

  async refresh() {
    const bridge = client();
    // No session is not an error: the screen says so and offers to start one.
    if (!bridge) {
      set({ rows: [], updatable: [] });
      return;
    }
    try {
      const [plugins, resources] = await Promise.all([bridge.listPlugins(), bridge.listResources()]);
      set({ rows: buildPluginRows({ configured: plugins.configured, resources }), error: undefined });
    } catch (error) {
      logger.error("unable to read the plugin list", error);
      set({ error: (error as Error).message });
    }
  },

  // Every mutation reports through the same path: one busy flag, the container's error text verbatim, and a
  // refetch afterwards so the table shows what pi has rather than what the GUI hoped for.
  async install(source, scope) {
    const parsed = parsePluginSource(source);
    if (parsed.kind === "invalid") {
      set({ error: parsed.reason });
      return;
    }
    await run(set, get, (bridge) => bridge.installPlugin(source, scope), { reload: true });
  },

  async remove(source, scope) {
    await run(set, get, (bridge) => bridge.removePlugin(source, scope), { reload: true });
  },

  async update(source) {
    await run(set, get, (bridge) => bridge.updatePlugins(source), { reload: true });
  },

  async checkUpdates() {
    await run(set, get, async (bridge) => {
      set({ updatable: await bridge.checkPluginUpdates() });
    });
  },

  // Enabling and disabling only rewrites settings, so pi is asked to reload: without it the resources of a
  // plugin just switched off would stay loaded for the rest of the session.
  async setEnabled(source, enabled, scope) {
    await run(set, get, (bridge) => bridge.setPluginEnabled(source, enabled, scope), { reload: true });
  },

  applyBridgeEvent(event) {
    if (event.type === "plugin_progress") {
      const finished = event.phase === "complete" || event.phase === "error";
      set({ progress: finished ? undefined : { source: event.source, message: event.message ?? event.action } });
      return;
    }
    if (event.type === "plugins_changed") void get().refresh();
  },

  attach() {
    const bridge = client();
    void get().refresh();
    if (!bridge) return () => {};
    return bridge.onEvent((event) => get().applyBridgeEvent(event));
  },
}));

// DEV-only handle for the WebDriver spec, mirroring installCodingAgentProbe: the spec seeds a stand-in bridge
// client and drives this store, so the table's rendering is asserted without installing real packages.
export function installPluginStoreProbe(): void {
  (globalThis as { __cdPluginStore?: typeof usePluginStore }).__cdPluginStore = usePluginStore;
}

// Shared shape of a mutation: hold busy, surface a failure as text rather than a throw into a click handler,
// then let pi reload and refetch.
async function run(
  set: (partial: Partial<PluginState>) => void,
  get: () => PluginState,
  operation: (bridge: NonNullable<ReturnType<typeof client>>) => Promise<unknown>,
  options: { reload?: boolean } = {},
): Promise<void> {
  const bridge = client();
  if (!bridge) {
    set({ error: "no coding agent session is running" });
    return;
  }
  set({ busy: true, error: undefined });
  let failure: string | undefined;
  try {
    await operation(bridge);
    if (options.reload) await bridge.reloadSession();
  } catch (error) {
    logger.error("a plugin operation failed", error);
    failure = (error as Error).message;
  } finally {
    set({ busy: false, progress: undefined });
  }
  // The refetch runs either way — a half-applied install still changed something — but it must not clear the
  // message that says why the operation failed, so the failure is re-applied after it.
  await get().refresh();
  if (failure) set({ error: failure });
}
