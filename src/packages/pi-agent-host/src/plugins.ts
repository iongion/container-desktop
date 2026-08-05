// Plugin management, as a face on pi's own package manager: nothing about resolution, installation or trust
// is reimplemented here. What this module owns is the two places pi's shape and the GUI's needs do not line
// up — reading the enabled flag back out of the raw settings entry, and turning pi's progress callback into
// bridge events.
import { createLogger } from "@/logger";
import type {
  BridgeEvent,
  ConfiguredPluginPackage,
  PluginListPayload,
  PluginProgressAction,
  PluginProgressPhase,
  PluginScope,
} from "@/pi-bridge/protocol";

const logger = createLogger("pi-agent-host.plugins");

// pi's `PackageSource`: a bare source string, or an object that filters what the package contributes.
export type PiPackageSource =
  | string
  | {
      source: string;
      autoload?: boolean;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
      themes?: string[];
    };

interface PiProgressEvent {
  type: PluginProgressPhase;
  action: PluginProgressAction;
  source: string;
  message?: string;
}

// The subset of pi's PackageManager this service calls, declared locally so the module is testable without
// constructing the real one. `checkForAvailableUpdates` is on DefaultPackageManager rather than the
// interface, hence optional.
export interface PackageManagerLike {
  installAndPersist(source: string, options?: { local?: boolean }): Promise<void>;
  removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean>;
  update(source?: string): Promise<void>;
  listConfiguredPackages(): Array<{
    source: string;
    scope: PluginScope;
    filtered: boolean;
    installedPath?: string;
  }>;
  setProgressCallback(callback: ((event: PiProgressEvent) => void) | undefined): void;
  checkForAvailableUpdates?(): Promise<Array<{ source: string }>>;
}

export interface SettingsLike {
  getGlobalSettings(): { packages?: PiPackageSource[] };
  getProjectSettings(): { packages?: PiPackageSource[] };
  setPackages(packages: PiPackageSource[]): void;
  setProjectPackages(packages: PiPackageSource[]): void;
  flush(): Promise<void>;
}

export interface PluginService {
  list(): PluginListPayload;
  install(source: string, scope: PluginScope): Promise<void>;
  remove(source: string, scope: PluginScope): Promise<void>;
  update(source?: string): Promise<void>;
  checkUpdates(): Promise<string[]>;
  // Disable keeps the package configured and on disk with autoload off, so re-enabling costs no download.
  setEnabled(source: string, enabled: boolean, scope: PluginScope): Promise<void>;
}

function sourceOf(entry: PiPackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

export function createPluginService(deps: {
  packageManager: PackageManagerLike;
  settings: SettingsLike;
  emit: (event: BridgeEvent) => void;
}): PluginService {
  const { packageManager, settings, emit } = deps;

  const readPackages = (scope: PluginScope): PiPackageSource[] => {
    const scoped = scope === "project" ? settings.getProjectSettings() : settings.getGlobalSettings();
    return scoped.packages ?? [];
  };

  const writePackages = async (scope: PluginScope, packages: PiPackageSource[]): Promise<void> => {
    if (scope === "project") settings.setProjectPackages(packages);
    else settings.setPackages(packages);
    // Settings writes are queued. A container stopped right after an install would otherwise lose the entry
    // while the files stayed in the volume — a plugin present on disk that nothing lists.
    await settings.flush();
  };

  // pi reports progress through one callback slot on the manager, so an operation claims it for its own
  // duration and always gives it back — a leaked callback would attribute the next install's lines to this
  // source.
  const withProgress = async <T>(run: () => Promise<T>): Promise<T> => {
    packageManager.setProgressCallback((event) => {
      emit({
        type: "plugin_progress",
        source: event.source,
        action: event.action,
        phase: event.type,
        ...(event.message === undefined ? {} : { message: event.message }),
      });
    });
    try {
      return await run();
    } finally {
      packageManager.setProgressCallback(undefined);
    }
  };

  const announce = () => emit({ type: "plugins_changed" });

  return {
    list(): PluginListPayload {
      // pi flattens the object form to `filtered: true` and drops autoload, so the flag is read back off the
      // raw entry. Matching on (source, scope) is exact: listConfiguredPackages derives its source the same way.
      const entries = new Map<string, PiPackageSource>();
      for (const scope of ["user", "project"] as const) {
        for (const entry of readPackages(scope)) entries.set(`${scope}:${sourceOf(entry)}`, entry);
      }
      const configured: ConfiguredPluginPackage[] = packageManager.listConfiguredPackages().map((entry) => {
        const raw = entries.get(`${entry.scope}:${entry.source}`);
        const autoload = typeof raw === "object" ? raw.autoload : undefined;
        return autoload === undefined ? { ...entry } : { ...entry, autoload };
      });
      return { configured };
    },

    async install(source, scope) {
      await withProgress(() => packageManager.installAndPersist(source, { local: scope === "project" }));
      announce();
    },

    async remove(source, scope) {
      await withProgress(() => packageManager.removeAndPersist(source, { local: scope === "project" }));
      announce();
    },

    async update(source) {
      await withProgress(() => packageManager.update(source));
      announce();
    },

    async checkUpdates() {
      if (!packageManager.checkForAvailableUpdates) return [];
      const updates = await packageManager.checkForAvailableUpdates();
      return updates.map((update) => update.source);
    },

    async setEnabled(source, enabled, scope) {
      const packages = readPackages(scope);
      const index = packages.findIndex((entry) => sourceOf(entry) === source);
      if (index === -1) throw new Error(`no configured plugin for ${source} in ${scope} settings`);
      const existing = packages[index];
      const filters = typeof existing === "object" ? { ...existing } : { source };
      let next: PiPackageSource;
      if (enabled) {
        delete filters.autoload;
        // Back to the plain string when nothing else was configured, so a round trip leaves the settings
        // file exactly as it was found.
        next = Object.keys(filters).length === 1 ? source : filters;
      } else {
        next = { ...filters, autoload: false };
      }
      const updated = [...packages];
      updated[index] = next;
      await writePackages(scope, updated);
      logger.debug(`plugin ${source} ${enabled ? "enabled" : "disabled"} in ${scope} settings`);
      announce();
    },
  };
}
