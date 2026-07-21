import type { ContainerEngine, ContainerEngineHost, Controller, EngineConnectorAvailability, Program } from "./engine";
import type { ControllerScope } from "./machine";
import type { ConnectionProxySettings } from "./network";
import type { ControllerScopeType } from "./os";
import type { CertAuthority, RegistryTrustEntry } from "./registry";

export interface ApiConnection {
  uri: string;
  relay: string;
  // When set, the engine API is reached NOT by `ssh -NL` forwarding `relay`, but by running this command
  // over the SSH link to produce a raw stdio bridge to the daemon — unified across engines (Docker `system
  // dial-stdio` on a Windows named pipe; Podman-machine: a nested OpenSSH hop into the VM + its local
  // dial-stdio). The SSH transport just runs whatever command the dialect resolved (see resolveDialStdioBridge).
  dialStdioCommand?: string[];
}

// How to bridge an engine whose API can't be `ssh -NL` forwarded: a stable relay id + the command to run.
export interface DialStdioBridge {
  // Stable, non-empty id for this bridge (the engine endpoint / machine URI) — the transport's cache key.
  relay: string;
  // Command run over the outer SSH to produce a raw stdio bridge to the engine daemon.
  command: string[];
}

export interface EngineConnectorApiSettings {
  baseURL: string;
  connection: ApiConnection;
  autoStart?: boolean;
  // Per-connection override for auto-reconnect after a drop. Unset = inherit the global default
  // (GlobalUserSettings.reconnect.enabled). true/false force it for this connection.
  autoReconnect?: boolean;
}

export interface EngineConnectorSettings {
  api: EngineConnectorApiSettings;
  program: Program;
  controller?: Controller;
  rootfull: boolean;
  mode: "mode.automatic" | "mode.manual";
  // Per-connection registry trust (Registries & Trust screen + the connection form's advanced sections). All
  // optional: absence = honest defaults (verify TLS, system CA, inherit the global proxy). These are the app's
  // MANAGED set only — the writers read-modify-write registries.conf/certs.d and never wipe user/system entries.
  registries?: RegistryTrustEntry[];
  certificates?: CertAuthority[];
  proxy?: ConnectionProxySettings;
}

export interface EngineUserSettingsOptions {
  id: string; // host client instance id
  settings: Partial<EngineConnectorSettings>;
}

export interface EngineApiOptions {
  engine: ContainerEngine;
  host: ContainerEngineHost;
  id: string; // host client instance id
  //
  scope: string; // ControllerScope Name
  baseURL: string;
  connection: ApiConnection;
}

export interface EngineProgramOptions {
  engine: ContainerEngine;
  host: ContainerEngineHost;
  id: string; // host client instance id
  //
  program: Partial<Program>;
  controller?: Partial<Controller>;
}

export interface SystemConnection {
  Identity: string;
  Name: string;
  URI: string;
}

export interface SSHHost {
  Name: string;
  Connected?: boolean;
  Usable?: boolean;
  Type: ControllerScopeType;
  // SSH
  Host: string;
  Port: number;
  HostName: string;
  User: string;
  IdentityFile: string;
  ConfigHost?: string;
}

export interface Connection {
  logLevel?: string;
  //
  name: string;
  label: string;
  description?: string;
  engine: ContainerEngine;
  host: ContainerEngineHost;
  disabled?: boolean;
  readonly?: boolean;
  //
  id: string;
  settings: EngineConnectorSettings;
}

export interface ConnectorCapabilities {
  resources: {
    pods: boolean;
    secrets: boolean;
    networks: boolean;
  };
  events: boolean;
  sort: Record<string, "client" | "server">;
  extensions: Record<
    | "machines"
    | "kube"
    | "contexts"
    | "swarm"
    | "builders"
    | "compose"
    | "registries"
    | "registryTrust"
    | "controllerVersion",
    boolean
  >;
}

export interface Connector extends Connection {
  connectionId: string;
  description: string;
  notes?: string;
  scopes?: ControllerScope[];
  availability: EngineConnectorAvailability;
  capabilities?: ConnectorCapabilities;
}

export interface ConnectOptions {
  startApi: boolean;
  connection: Connection;
  skipAvailabilityCheck: boolean;
  origin?: string;
}

export interface DisconnectOptions {
  stopApi: boolean;
  connection: Connection;
}
