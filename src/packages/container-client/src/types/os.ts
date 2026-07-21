import type { Container } from "./container";
import type { ContainerImage } from "./image";
import { LIMAInstance, type PodmanMachine, WSLDistribution } from "./machine";
import type { Volume } from "./volume";

export enum ControllerScopeType {
  PodmanMachine = "PodmanMachine",
  WSLDistribution = "WSLDistribution",
  LIMAInstance = "LIMAInstance",
  SSHConnection = "SSHConnection",
}

export enum OperatingSystem {
  Browser = "browser",
  Linux = "Linux",
  MacOS = "Darwin",
  Windows = "Windows_NT",
  Unknown = "unknown",
}

export enum Environments {
  DEVELOPMENT = "development",
  PRODUCTION = "production",
}

export enum WindowAction {
  Minimize = "window.minimize",
  Maximize = "window.maximize",
  Restore = "window.restore",
  Close = "window.close",
}

export interface SystemNotification {
  guid: string;
  type: string;
  date: Date;
  data?: any;
}

export interface FileSelection {
  canceled: boolean;
  filePaths: string[];
}

export interface OpenFileSelectorOptions {
  directory?: boolean;
  multiple?: boolean;
  filters?: any;
  // Starting directory (or file) for the native picker. Honored by both the Electron and Tauri backends.
  defaultPath?: string;
}

export interface OpenTerminalOptions {
  command?: string;
  // terminal inside machine
  machine?: string;
}

// Apple Container is an engine, not a user-selectable theme — it renders the unified theme by
// definition (see engineTheme.ts / tokens.css). So "container" is intentionally absent here.
export type EngineThemePreference = "auto" | "unified" | "podman" | "docker";

// Local-only file logging (opt-in, OFF by default). The log file lives under the app's userData
// directory; rotation is size-based with a bounded number of kept files. NEVER a remote/cloud sink.
// First-run provisioning wizard state, persisted under GlobalUserSettings.wizard.
export interface WizardSettings {
  skipAtStartup: boolean;
  lastCompletedVersion?: string;
  dismissedAt?: string;
  // ISO timestamp written the first time the wizard auto-opens. Its presence is the "already shown once"
  // sentinel that keeps the wizard from auto-opening on every launch (the header button opens it manually).
  firstRunHandledAt?: string;
}

export enum Features {
  polling = "polling",
}

export interface Feature {
  enabled: boolean;
  opts?: any;
}

export type FeaturesMap = {
  [key in Features]?: Feature;
};

export interface EnvironmentSettings {
  api: {
    baseUrl: string;
  };
  poll: {
    rate: number;
  };
}

export interface Environment {
  name: Environments;
  features: FeaturesMap;
  settings: EnvironmentSettings;
}

export interface Domain {
  containers: Container[];
  images: ContainerImage[];
  machines: PodmanMachine[];
  volumes: Volume[];
}
