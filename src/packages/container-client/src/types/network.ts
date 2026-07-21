import type { ContainerEngine, ContainerEngineHost } from "./engine";

export interface ProxyServiceOptions {
  http?: boolean;
  keepAlive?: boolean;
}

export interface ProxyRequest {
  request: any;
  baseURL: string;
  socketPath?: string;
  host: ContainerEngineHost;
  engine: ContainerEngine;
  scope?: string;
}

export interface NetworkIPAMOptions {
  [key: string]: string;
}

export interface NetworkSubnetLeaseRange {
  end_ip: string;
  start_ip: string;
}

export interface NetworkSubnet {
  gateway: string;
  lease_range: NetworkSubnetLeaseRange;
  subnet: string;
}

export interface Network {
  created: string;
  dns_enabled: boolean;
  driver: string;
  id: string;
  internal: boolean;
  ipam_options: NetworkIPAMOptions;
  ipv6_enabled: boolean;
  labels: { [key: string]: string };
  name: string;
  network_interface: string;
  options: { [key: string]: string };
  subnets: NetworkSubnet[];
}

// Proxy configuration DTO — the origin (import from @/container-client/Types everywhere). Consumed by GlobalUserSettings.proxy
// and Connection.proxy (ConnectionProxySettings) below; the proxy LOGIC (normalize/validate) lives in
// @/container-client/proxy, which imports this type.
export type ProxyMode = "disabled" | "manual";

export type ProxyProtocol = "http" | "https" | "socks5";

export interface ProxyConfig {
  mode: ProxyMode;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string;
  password: string;
  bypass: string[];
}

// Per-connection proxy override. `inherit` = use the global GlobalUserSettings.proxy; `override` = use `config`;
// `off` = no proxy for this connection. `config` is only meaningful when mode === "override".
export type ConnectionProxyMode = "inherit" | "override" | "off";

export interface ConnectionProxySettings {
  mode: ConnectionProxyMode;
  config?: ProxyConfig;
}
