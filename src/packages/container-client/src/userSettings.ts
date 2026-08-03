// Persisted app configuration — the origin. Owned by container-client (the config domain:
// userConfiguration reads/writes it, Application.getGlobalUserSettings normalizes it). Import from
// @/container-client/userSettings everywhere; no re-exports.
import type { AISettings } from "@/ai-system/core/types";
import type { Connection } from "@/container-client/types/connection";
import type { ContainerEngineHost, Program } from "@/container-client/types/engine";
import type { ProxyConfig } from "@/container-client/types/network";
import type { EngineThemePreference, WizardSettings } from "@/container-client/types/os";
import type { Registry } from "@/container-client/types/registry";
import type { LanguagePreference } from "@/i18n";
import type { LoggingFileSettings } from "@/logger/loggingSettings";

export interface GlobalUserSettings {
  theme: string;
  language: LanguagePreference;
  engineTheme: EngineThemePreference;
  showEngineColumn: boolean;
  // Group resource lists by connection. Only takes effect with more than one connection connected (a single
  // connection always renders flat); default on. Off = one merged, globally-sorted list per screen.
  groupByConnection: boolean;
  expandSidebar: boolean;
  startApi: boolean;
  minimizeToSystemTray: boolean;
  checkLatestVersion: boolean;
  path: string;
  font?: {
    family?: string;
    size?: number;
    weight?: number;
  };
  logging: {
    level: string;
    // File-logging policy (rotation + size caps). Optional for back-compat with older configs;
    // Application.getGlobalUserSettings always populates it via normalizeLoggingFileSettings.
    file?: LoggingFileSettings;
  };
  connections: Connection[];
  connector: {
    default: string | undefined;
  };
  // Auto-reconnect policy applied when a live connection drops (engine stop, SSH broken, internet down).
  // Global default; a connection may override via its api.autoReconnect. Optional for back-compat — main
  // falls back to enabled with a 1s→30s exponential back-off when this is absent.
  reconnect?: {
    enabled: boolean;
    initialMs?: number;
    maxMs?: number;
    factor?: number;
    maxRetries?: number;
  };
  registries: Registry[];
  // AI subsystem settings. Always populated at runtime by normalizeAISettings()
  // in Application.getGlobalUserSettings — opt-in, off by default, local-first.
  ai: AISettings;
  // Global app proxy. Optional for older configs; absence normalizes to disabled at runtime.
  proxy?: ProxyConfig;
  // First-run provisioning wizard state. Optional for back-compat; normalized to { skipAtStartup:false }
  // in getGlobalUserSettings so a fresh config shows the wizard once (the renderer gates on `!== true`).
  wizard?: WizardSettings;
}

export interface GlobalUserSettingsOptions extends GlobalUserSettings {
  program: Partial<Program>;
  host: Partial<ContainerEngineHost>;
}
