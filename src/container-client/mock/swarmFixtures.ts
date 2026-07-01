// mock/swarmFixtures.ts — deterministic Docker Swarm seed data for mock-mode UI development + the UI e2e.
//
// Swarm is DOCKER-ONLY. Podman (even in docker-compat mode) and the Apple `container` engine have Docker
// compatibility layers but do NOT implement swarm — so mockApiAdapter serves these ONLY for the Docker
// engine, and the capability flag stays false on podman/container. These seeds are hand-written (not the
// faker generator) and deliberately cover the common swarm shapes a developer/tester needs to see:
//   • services: replicated (converged), replicated (converging), global mode, published ports, standalone
//     (no stack) vs stack-owned across TWO stacks (`shop`, `monitoring`);
//   • nodes: leader manager, reachable non-leader manager, active worker, drained worker, down worker;
//   • tasks: running / shutdown / failed / rejected / pending across services and nodes;
//   • cluster secrets + configs (with and without labels).

import type { SwarmConfig, SwarmInfo, SwarmNode, SwarmSecret, SwarmService, SwarmTask } from "@/env/Types";

const TS = "2024-01-01T00:00:00.000Z";
const NS = "com.docker.stack.namespace";

export interface SwarmFixture {
  info: SwarmInfo;
  services: SwarmService[];
  nodes: SwarmNode[];
  tasks: SwarmTask[];
  secrets: SwarmSecret[];
  configs: SwarmConfig[];
}

export const SWARM_FIXTURE: SwarmFixture = {
  info: {
    ID: "mock-swarm-cluster",
    Version: { Index: 42 },
    CreatedAt: TS,
    UpdatedAt: TS,
    Spec: { Name: "default", Labels: {} },
    JoinTokens: { Worker: "SWMTKN-1-mockworkertoken", Manager: "SWMTKN-1-mockmanagertoken" },
  },
  services: [
    // stack "shop" (3 services)
    {
      ID: "svc_shop_web",
      Version: { Index: 11 },
      CreatedAt: TS,
      UpdatedAt: TS,
      Spec: {
        Name: "shop_web",
        Labels: { [NS]: "shop" },
        Mode: { Replicated: { Replicas: 3 } },
        TaskTemplate: { ContainerSpec: { Image: "nginx:alpine" } },
      },
      Endpoint: { Ports: [{ Protocol: "tcp", TargetPort: 80, PublishedPort: 8080 }] },
    },
    {
      ID: "svc_shop_api",
      Version: { Index: 7 },
      CreatedAt: TS,
      Spec: {
        Name: "shop_api",
        Labels: { [NS]: "shop" },
        // Converging: 2 desired, only 1 task running (see tasks below).
        Mode: { Replicated: { Replicas: 2 } },
        TaskTemplate: { ContainerSpec: { Image: "shop/api:1.4.0" } },
      },
      Endpoint: { Ports: [{ Protocol: "tcp", TargetPort: 8000, PublishedPort: 8000 }] },
    },
    {
      ID: "svc_shop_redis",
      Version: { Index: 4 },
      CreatedAt: TS,
      Spec: {
        Name: "shop_redis",
        Labels: { [NS]: "shop" },
        Mode: { Replicated: { Replicas: 1 } },
        TaskTemplate: { ContainerSpec: { Image: "redis:7-alpine" } },
      },
      Endpoint: { Ports: [] },
    },
    // stack "monitoring" (2 services, one GLOBAL)
    {
      ID: "svc_mon_grafana",
      Version: { Index: 9 },
      CreatedAt: TS,
      Spec: {
        Name: "monitoring_grafana",
        Labels: { [NS]: "monitoring" },
        Mode: { Replicated: { Replicas: 1 } },
        TaskTemplate: { ContainerSpec: { Image: "grafana/grafana:11.2.0" } },
      },
      Endpoint: { Ports: [{ Protocol: "tcp", TargetPort: 3000, PublishedPort: 3000 }] },
    },
    {
      ID: "svc_mon_node_exporter",
      Version: { Index: 6 },
      CreatedAt: TS,
      Spec: {
        Name: "monitoring_node-exporter",
        Labels: { [NS]: "monitoring" },
        Mode: { Global: {} },
        TaskTemplate: { ContainerSpec: { Image: "prom/node-exporter:v1.8.2" } },
      },
      Endpoint: { Ports: [] },
    },
    // standalone services (no stack namespace)
    {
      ID: "svc_viz",
      Version: { Index: 3 },
      CreatedAt: TS,
      Spec: {
        Name: "viz",
        Labels: {},
        Mode: { Replicated: { Replicas: 1 } },
        TaskTemplate: { ContainerSpec: { Image: "dockersamples/visualizer:stable" } },
      },
      Endpoint: { Ports: [{ Protocol: "tcp", TargetPort: 8080, PublishedPort: 9090 }] },
    },
    {
      ID: "svc_proxy",
      Version: { Index: 2 },
      CreatedAt: TS,
      Spec: {
        Name: "proxy",
        Labels: {},
        Mode: { Replicated: { Replicas: 2 } },
        TaskTemplate: { ContainerSpec: { Image: "traefik:v3.1" } },
      },
      Endpoint: {
        Ports: [
          { Protocol: "tcp", TargetPort: 80, PublishedPort: 80 },
          { Protocol: "tcp", TargetPort: 443, PublishedPort: 443 },
        ],
      },
    },
  ],
  nodes: [
    {
      ID: "node_mgr_1",
      Version: { Index: 20 },
      CreatedAt: TS,
      Spec: { Role: "manager", Availability: "active" },
      Description: {
        Hostname: "swarm-mgr-1",
        Platform: { Architecture: "x86_64", OS: "linux" },
        Engine: { EngineVersion: "27.3.1" },
        Resources: { NanoCPUs: 4_000_000_000, MemoryBytes: 8 * 1024 ** 3 },
      },
      Status: { State: "ready", Addr: "10.0.0.1" },
      ManagerStatus: { Leader: true, Reachability: "reachable", Addr: "10.0.0.1:2377" },
    },
    {
      ID: "node_mgr_2",
      Version: { Index: 18 },
      CreatedAt: TS,
      Spec: { Role: "manager", Availability: "active" },
      Description: {
        Hostname: "swarm-mgr-2",
        Platform: { Architecture: "x86_64", OS: "linux" },
        Engine: { EngineVersion: "27.3.1" },
        Resources: { NanoCPUs: 4_000_000_000, MemoryBytes: 8 * 1024 ** 3 },
      },
      Status: { State: "ready", Addr: "10.0.0.2" },
      ManagerStatus: { Leader: false, Reachability: "reachable", Addr: "10.0.0.2:2377" },
    },
    {
      ID: "node_wkr_1",
      Version: { Index: 15 },
      CreatedAt: TS,
      Spec: { Role: "worker", Availability: "active" },
      Description: {
        Hostname: "swarm-wkr-1",
        Platform: { Architecture: "x86_64", OS: "linux" },
        Engine: { EngineVersion: "27.3.1" },
        Resources: { NanoCPUs: 8_000_000_000, MemoryBytes: 16 * 1024 ** 3 },
      },
      Status: { State: "ready", Addr: "10.0.0.3" },
    },
    {
      ID: "node_wkr_2",
      Version: { Index: 15 },
      CreatedAt: TS,
      Spec: { Role: "worker", Availability: "drain" },
      Description: {
        Hostname: "swarm-wkr-2",
        Platform: { Architecture: "aarch64", OS: "linux" },
        Engine: { EngineVersion: "27.3.1" },
        Resources: { NanoCPUs: 8_000_000_000, MemoryBytes: 16 * 1024 ** 3 },
      },
      Status: { State: "ready", Addr: "10.0.0.4" },
    },
    {
      ID: "node_wkr_3",
      Version: { Index: 12 },
      CreatedAt: TS,
      Spec: { Role: "worker", Availability: "active" },
      Description: {
        Hostname: "swarm-wkr-3",
        Platform: { Architecture: "x86_64", OS: "linux" },
        Engine: { EngineVersion: "26.1.4" },
        Resources: { NanoCPUs: 4_000_000_000, MemoryBytes: 8 * 1024 ** 3 },
      },
      Status: { State: "down", Addr: "10.0.0.5" },
    },
  ],
  tasks: [
    // shop_web — 3/3 running across nodes
    {
      ID: "task_web_1",
      ServiceID: "svc_shop_web",
      NodeID: "node_mgr_1",
      Slot: 1,
      CreatedAt: TS,
      DesiredState: "running",
      Status: { State: "running", Timestamp: TS },
      Spec: { ContainerSpec: { Image: "nginx:alpine" } },
    },
    {
      ID: "task_web_2",
      ServiceID: "svc_shop_web",
      NodeID: "node_wkr_1",
      Slot: 2,
      CreatedAt: TS,
      DesiredState: "running",
      Status: { State: "running", Timestamp: TS },
      Spec: { ContainerSpec: { Image: "nginx:alpine" } },
    },
    {
      ID: "task_web_3",
      ServiceID: "svc_shop_web",
      NodeID: "node_wkr_2",
      Slot: 3,
      CreatedAt: TS,
      DesiredState: "running",
      Status: { State: "running", Timestamp: TS },
      Spec: { ContainerSpec: { Image: "nginx:alpine" } },
    },
    // shop_api — converging: slot 1 running, slot 2 rejected + a shutdown retry
    {
      ID: "task_api_1",
      ServiceID: "svc_shop_api",
      NodeID: "node_wkr_1",
      Slot: 1,
      CreatedAt: TS,
      DesiredState: "running",
      Status: { State: "running", Timestamp: TS },
      Spec: { ContainerSpec: { Image: "shop/api:1.4.0" } },
    },
    {
      ID: "task_api_2",
      ServiceID: "svc_shop_api",
      NodeID: "node_wkr_3",
      Slot: 2,
      CreatedAt: TS,
      DesiredState: "running",
      Status: { State: "rejected", Timestamp: TS, Message: "node is down" },
      Spec: { ContainerSpec: { Image: "shop/api:1.4.0" } },
    },
    {
      ID: "task_api_2b",
      ServiceID: "svc_shop_api",
      NodeID: "node_wkr_1",
      Slot: 2,
      CreatedAt: TS,
      DesiredState: "shutdown",
      Status: { State: "failed", Timestamp: TS, Message: "task: non-zero exit (1)" },
      Spec: { ContainerSpec: { Image: "shop/api:1.4.0" } },
    },
    // shop_redis
    {
      ID: "task_redis_1",
      ServiceID: "svc_shop_redis",
      NodeID: "node_mgr_2",
      Slot: 1,
      CreatedAt: TS,
      DesiredState: "running",
      Status: { State: "running", Timestamp: TS },
      Spec: { ContainerSpec: { Image: "redis:7-alpine" } },
    },
    // proxy — 2 desired, 1 running + 1 pending
    {
      ID: "task_proxy_1",
      ServiceID: "svc_proxy",
      NodeID: "node_mgr_1",
      Slot: 1,
      CreatedAt: TS,
      DesiredState: "running",
      Status: { State: "running", Timestamp: TS },
      Spec: { ContainerSpec: { Image: "traefik:v3.1" } },
    },
    {
      ID: "task_proxy_2",
      ServiceID: "svc_proxy",
      NodeID: "node_wkr_1",
      Slot: 2,
      CreatedAt: TS,
      DesiredState: "running",
      Status: { State: "pending", Timestamp: TS, Message: "no suitable node" },
      Spec: { ContainerSpec: { Image: "traefik:v3.1" } },
    },
    // viz (standalone)
    {
      ID: "task_viz_1",
      ServiceID: "svc_viz",
      NodeID: "node_mgr_1",
      Slot: 1,
      CreatedAt: TS,
      DesiredState: "running",
      Status: { State: "running", Timestamp: TS },
      Spec: { ContainerSpec: { Image: "dockersamples/visualizer:stable" } },
    },
  ],
  secrets: [
    {
      ID: "sec_db_password",
      Version: { Index: 2 },
      CreatedAt: TS,
      UpdatedAt: TS,
      Spec: { Name: "db_password", Labels: {} },
    },
    {
      ID: "sec_tls_cert",
      Version: { Index: 2 },
      CreatedAt: TS,
      UpdatedAt: TS,
      Spec: { Name: "tls_cert", Labels: { [NS]: "shop" } },
    },
    {
      ID: "sec_api_key",
      Version: { Index: 1 },
      CreatedAt: TS,
      UpdatedAt: TS,
      Spec: { Name: "api_key", Labels: { rotation: "monthly" } },
    },
  ],
  configs: [
    { ID: "cfg_nginx", Version: { Index: 1 }, CreatedAt: TS, UpdatedAt: TS, Spec: { Name: "nginx_conf", Labels: {} } },
    {
      ID: "cfg_app",
      Version: { Index: 3 },
      CreatedAt: TS,
      UpdatedAt: TS,
      Spec: { Name: "app_config", Labels: { [NS]: "shop" } },
    },
  ],
};
