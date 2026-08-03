// Curated, real-world value pools. These are what make the generated data read like an actual machine
// (real image refs, sensible ports, compose-style projects) instead of lorem ipsum. The generator
// (model.ts) draws from these deterministically.

import type { ContainerStateValue } from "./model";

export interface ImageCatalogEntry {
  // Registry host. "docker.io" for Hub; others (quay.io/ghcr.io/gcr.io) exercise the registry split.
  registry: string;
  // Full repository path INCLUDING "library/" for Hub official images (e.g. "library/nginx", "prom/prometheus").
  repo: string;
  // Allowed tags — drawn from so we never invent an implausible tag (e.g. nginx:99).
  tags: string[];
  // Long-running server that binds a port, vs a one-shot/worker base image.
  exposesPort: boolean;
  // Canonical container port for exposesPort images.
  port?: number;
  // Size band in bytes [min, max].
  size: [number, number];
  // Default command (podman keeps the array; docker joins to a string).
  cmd: string[];
  // Optional entrypoint for inspect.
  entrypoint?: string[];
  // Config.Env hints for inspect.
  env: string[];
  maintainer?: string;
  // Preferred compose service name when this image anchors a service.
  service: string;
}

const MB = 1_000_000;

export const IMAGE_CATALOG: ImageCatalogEntry[] = [
  {
    registry: "docker.io",
    repo: "library/nginx",
    service: "web",
    tags: ["1.27-alpine", "1.27", "1.26-alpine", "stable-alpine"],
    exposesPort: true,
    port: 80,
    size: [20 * MB, 60 * MB],
    cmd: ["nginx", "-g", "daemon off;"],
    entrypoint: ["/docker-entrypoint.sh"],
    env: ["PATH=/usr/local/sbin", "NGINX_VERSION=1.27"],
    maintainer: "NGINX Docker Maintainers",
  },
  {
    registry: "docker.io",
    repo: "library/httpd",
    service: "web",
    tags: ["2.4-alpine", "2.4", "alpine"],
    exposesPort: true,
    port: 80,
    size: [40 * MB, 70 * MB],
    cmd: ["httpd-foreground"],
    env: ["HTTPD_VERSION=2.4"],
  },
  {
    registry: "docker.io",
    repo: "library/php",
    service: "php",
    tags: ["8.3-fpm-alpine", "8.3-fpm", "8.2-fpm-alpine"],
    exposesPort: true,
    port: 9000,
    size: [90 * MB, 130 * MB],
    cmd: ["php-fpm"],
    env: ["PHP_VERSION=8.3"],
  },
  {
    registry: "docker.io",
    repo: "library/traefik",
    service: "edge",
    tags: ["v3.1", "v2.11", "v3.0"],
    exposesPort: true,
    port: 80,
    size: [120 * MB, 160 * MB],
    cmd: ["traefik", "--providers.file", "--entrypoints.websecure"],
    env: [],
  },
  {
    registry: "docker.io",
    repo: "library/postgres",
    service: "db",
    tags: ["16", "16-alpine", "15", "15-alpine"],
    exposesPort: true,
    port: 5432,
    size: [80 * MB, 440 * MB],
    cmd: ["postgres"],
    entrypoint: ["docker-entrypoint.sh"],
    env: [
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "GOSU_VERSION=1.17",
      "LANG=en_US.utf8",
      "PG_MAJOR=16",
      "PG_VERSION=16.4-1.pgdg120+1",
      "PGDATA=/var/lib/postgresql/data",
      "POSTGRES_USER=app",
      "POSTGRES_PASSWORD=app_dev_password",
      "POSTGRES_DB=app",
      "POSTGRES_INITDB_ARGS=--data-checksums",
    ],
  },
  {
    registry: "docker.io",
    repo: "library/mariadb",
    service: "db",
    tags: ["11", "10.11", "11-jammy"],
    exposesPort: true,
    port: 3306,
    size: [300 * MB, 420 * MB],
    cmd: ["mariadbd"],
    entrypoint: ["docker-entrypoint.sh"],
    env: ["MARIADB_DATABASE=app", "MARIADB_USER=app"],
  },
  {
    registry: "docker.io",
    repo: "library/mysql",
    service: "db",
    tags: ["8.4", "8.0", "8.4-oracle"],
    exposesPort: true,
    port: 3306,
    size: [580 * MB, 640 * MB],
    cmd: ["mysqld"],
    env: ["MYSQL_DATABASE=app", "MYSQL_USER=app"],
  },
  {
    registry: "docker.io",
    repo: "library/redis",
    service: "cache",
    tags: ["7-alpine", "7", "6-alpine"],
    exposesPort: true,
    port: 6379,
    size: [30 * MB, 50 * MB],
    cmd: ["redis-server", "--appendonly", "yes"],
    env: [],
  },
  {
    registry: "docker.io",
    repo: "library/memcached",
    service: "cache",
    tags: ["1.6-alpine", "1.6"],
    exposesPort: true,
    port: 11211,
    size: [8 * MB, 16 * MB],
    cmd: ["memcached", "-m", "64"],
    env: [],
  },
  {
    registry: "docker.io",
    repo: "library/mongo",
    service: "db",
    tags: ["7", "6", "7-jammy"],
    exposesPort: true,
    port: 27017,
    size: [650 * MB, 780 * MB],
    cmd: ["mongod"],
    env: [],
  },
  {
    registry: "docker.io",
    repo: "library/rabbitmq",
    service: "queue",
    tags: ["3.13-management", "3.12-alpine"],
    exposesPort: true,
    port: 5672,
    size: [200 * MB, 260 * MB],
    cmd: ["rabbitmq-server"],
    env: [],
  },
  {
    registry: "docker.io",
    repo: "prom/prometheus",
    service: "prometheus",
    tags: ["v2.55.0", "v2.54.1", "v2.53.2"],
    exposesPort: true,
    port: 9090,
    size: [240 * MB, 300 * MB],
    cmd: ["--config.file=/etc/prometheus/prometheus.yml"],
    env: [],
  },
  {
    registry: "docker.io",
    repo: "grafana/grafana",
    service: "grafana",
    tags: ["11.3.0", "11.2.0", "10.4.2"],
    exposesPort: true,
    port: 3000,
    size: [380 * MB, 460 * MB],
    cmd: ["/run.sh"],
    env: ["GF_PATHS_DATA=/var/lib/grafana"],
  },
  {
    registry: "docker.io",
    repo: "grafana/loki",
    service: "loki",
    tags: ["3.2.0", "3.1.0"],
    exposesPort: true,
    port: 3100,
    size: [70 * MB, 110 * MB],
    cmd: ["-config.file=/etc/loki/local-config.yaml"],
    env: [],
  },
  {
    registry: "docker.io",
    repo: "grafana/tempo",
    service: "tempo",
    tags: ["2.6.0", "2.5.0"],
    exposesPort: true,
    port: 3200,
    size: [110 * MB, 150 * MB],
    cmd: ["-config.file=/etc/tempo.yaml"],
    env: [],
  },
  {
    registry: "docker.io",
    repo: "library/node",
    service: "api",
    tags: ["22-alpine", "20-alpine", "22"],
    exposesPort: false,
    size: [140 * MB, 200 * MB],
    cmd: ["node", "server.js"],
    env: ["NODE_ENV=production", "PORT=3000"],
  },
  {
    registry: "docker.io",
    repo: "library/python",
    service: "worker",
    tags: ["3.12-slim", "3.11-alpine", "3.12-alpine"],
    exposesPort: false,
    size: [50 * MB, 130 * MB],
    cmd: ["python", "worker.py"],
    env: ["PYTHONUNBUFFERED=1"],
  },
  {
    registry: "docker.io",
    repo: "library/golang",
    service: "builder",
    tags: ["1.23-alpine", "1.22-alpine"],
    exposesPort: false,
    size: [240 * MB, 360 * MB],
    cmd: ["sh", "-c", "go build ./..."],
    env: ["CGO_ENABLED=0"],
  },
  {
    registry: "docker.io",
    repo: "library/busybox",
    service: "worker",
    tags: ["1.36", "1.37", "latest"],
    exposesPort: false,
    size: [4 * MB, 6 * MB],
    cmd: ["sh", "-c", "while true; do echo processing; sleep 30; done"],
    env: [],
  },
  {
    registry: "docker.io",
    repo: "library/alpine",
    service: "job",
    tags: ["3.20", "3.19", "3.21"],
    exposesPort: false,
    size: [7 * MB, 9 * MB],
    cmd: ["sh"],
    env: [],
  },
  {
    registry: "docker.io",
    repo: "library/ubuntu",
    service: "job",
    tags: ["24.04", "22.04", "noble"],
    exposesPort: false,
    size: [70 * MB, 90 * MB],
    cmd: ["bash"],
    env: [],
  },
  {
    registry: "quay.io",
    repo: "keycloak/keycloak",
    service: "keycloak",
    tags: ["26.0", "25.0", "24.0"],
    exposesPort: true,
    port: 8080,
    size: [420 * MB, 520 * MB],
    cmd: ["start"],
    entrypoint: ["/opt/keycloak/bin/kc.sh"],
    env: ["KC_DB=postgres"],
  },
  {
    registry: "quay.io",
    repo: "prometheus/node-exporter",
    service: "node-exporter",
    tags: ["v1.8.2", "v1.7.0"],
    exposesPort: true,
    port: 9100,
    size: [22 * MB, 30 * MB],
    cmd: ["--path.rootfs=/host"],
    env: [],
  },
  {
    registry: "ghcr.io",
    repo: "cloudnative-pg/cloudnative-pg",
    service: "operator",
    tags: ["1.24.0", "1.23.2"],
    exposesPort: false,
    size: [150 * MB, 210 * MB],
    cmd: ["/manager"],
    env: [],
  },
  {
    registry: "gcr.io",
    repo: "distroless/static",
    service: "sidecar",
    tags: ["nonroot", "latest"],
    exposesPort: false,
    size: [2 * MB, 4 * MB],
    cmd: ["/app"],
    env: [],
  },
];

// A compose project = a named group of services. Used to build realistic multi-service container groups.
export interface ProjectTemplate {
  name: string;
  // Service definitions: a repo from the catalog + optional replica count + optional pinned state.
  services: { repo: string; service: string; replicas?: number; state?: ContainerStateValue }[];
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    name: "acme",
    services: [
      { repo: "library/postgres", service: "db", state: "running" },
      { repo: "library/nginx", service: "web", replicas: 2 },
    ],
  },
  {
    name: "lamp",
    services: [
      { repo: "library/httpd", service: "web", replicas: 2 },
      { repo: "library/php", service: "php" },
      { repo: "library/mariadb", service: "db" },
      { repo: "library/redis", service: "redis" },
    ],
  },
  {
    name: "observability",
    services: [
      { repo: "prom/prometheus", service: "prometheus" },
      { repo: "grafana/grafana", service: "grafana" },
      { repo: "grafana/loki", service: "loki" },
      { repo: "grafana/tempo", service: "tempo" },
      { repo: "prometheus/node-exporter", service: "node-exporter", replicas: 2 },
    ],
  },
  {
    name: "shop",
    services: [
      { repo: "library/nginx", service: "web", replicas: 3 },
      { repo: "library/node", service: "api", replicas: 2 },
      { repo: "library/postgres", service: "db" },
      { repo: "library/redis", service: "cache" },
    ],
  },
  {
    name: "payments",
    services: [
      { repo: "library/node", service: "api", replicas: 2 },
      { repo: "library/postgres", service: "db" },
      { repo: "library/python", service: "fraud-rules" },
    ],
  },
  {
    name: "identity",
    services: [
      { repo: "keycloak/keycloak", service: "keycloak" },
      { repo: "library/postgres", service: "db" },
    ],
  },
  {
    name: "inventory",
    services: [
      { repo: "library/golang", service: "sap-sync" },
      { repo: "library/rabbitmq", service: "queue" },
    ],
  },
  {
    name: "edge",
    services: [
      { repo: "library/traefik", service: "ingress" },
      { repo: "library/alpine", service: "cert-renewer" },
    ],
  },
  {
    name: "messaging",
    services: [
      { repo: "library/rabbitmq", service: "broker", replicas: 2 },
      { repo: "library/node", service: "schema-registry" },
    ],
  },
  {
    name: "ml",
    services: [
      { repo: "library/python", service: "inference", replicas: 2 },
      { repo: "library/python", service: "model-loader" },
    ],
  },
  {
    name: "data",
    services: [
      { repo: "library/python", service: "extract" },
      { repo: "library/python", service: "load" },
      { repo: "library/postgres", service: "warehouse" },
    ],
  },
  {
    name: "ci",
    services: [
      { repo: "library/golang", service: "runner", replicas: 2 },
      { repo: "library/busybox", service: "buildkit" },
    ],
  },
  {
    name: "registry",
    services: [
      { repo: "library/nginx", service: "proxy-cache" },
      { repo: "library/redis", service: "cache" },
    ],
  },
  {
    name: "security",
    services: [
      { repo: "library/alpine", service: "scanner" },
      { repo: "library/busybox", service: "cache-warmer" },
    ],
  },
];

// Standalone single-container apps used to top up to the container target. Names are single tokens (no
// "-"/"_") so each becomes its own one-item group — exercising the singleton path in the grouped/virtualized
// list. The repo is just a plausible runtime; it need not match the app name for mock data.
export const STANDALONE_APPS: { name: string; repo: string }[] = [
  { name: "adminer", repo: "library/php" },
  { name: "portainer", repo: "library/alpine" },
  { name: "dozzle", repo: "library/golang" },
  { name: "watchtower", repo: "library/alpine" },
  { name: "whoami", repo: "library/traefik" },
  { name: "netdata", repo: "library/alpine" },
  { name: "gitea", repo: "library/golang" },
  { name: "vaultwarden", repo: "library/alpine" },
  { name: "homepage", repo: "library/node" },
  { name: "syncthing", repo: "library/alpine" },
  { name: "filebrowser", repo: "library/golang" },
  { name: "cadvisor", repo: "library/golang" },
  { name: "minio", repo: "library/golang" },
  { name: "glances", repo: "library/python" },
  { name: "drone", repo: "library/golang" },
  { name: "mailhog", repo: "library/golang" },
  { name: "jellyfin", repo: "library/ubuntu" },
  { name: "pihole", repo: "library/alpine" },
  { name: "uptimekuma", repo: "library/node" },
  { name: "registryui", repo: "library/node" },
];

// Pod base names (Podman). The pod is named "<base>-pod", its infra container "<base>-infra".
export const POD_BASES = [
  "retail-checkout",
  "payments-api",
  "identity-keycloak",
  "orders-workers",
  "inventory-sync",
  "observability-stack",
  "edge-ingress",
  "registry-cache",
  "ci-runners",
  "ml-inference",
  "data-pipeline",
  "security-scanner",
  "messaging-kafka",
  "notifications",
  "search-index",
  "billing",
  "analytics",
  "recommendations",
  "feature-flags",
  "session-store",
];

// Network base names used for non-default project networks.
export const NETWORK_BASES = [
  "lamp",
  "ops",
  "shop",
  "payments",
  "platform",
  "edge",
  "ci",
  "ml",
  "data",
  "messaging",
  "security",
  "inventory",
  "frontend",
  "backend",
  "infra",
  "mgmt",
];

// Volume name stems.
export const VOLUME_STEMS = [
  "web-data",
  "db-data",
  "pg-data",
  "redis-data",
  "grafana-data",
  "prom-data",
  "loki-data",
  "cache",
  "uploads",
  "backups",
  "certs",
  "logs",
  "artifacts",
  "models",
  "warehouse",
  "config",
];

// Secret name stems.
export const SECRET_STEMS = [
  "db_password",
  "db_root_password",
  "registry_token",
  "api_key",
  "tls_cert",
  "tls_key",
  "jwt_signing_key",
  "smtp_password",
  "oauth_client_secret",
  "s3_access_key",
  "s3_secret_key",
  "grafana_admin",
  "redis_password",
  "webhook_secret",
  "license_key",
];

// Registry hosts for the generated registries list.
export const REGISTRY_HOSTS = [
  "docker.io",
  "quay.io",
  "ghcr.io",
  "gcr.io",
  "registry.gitlab.com",
  "public.ecr.aws",
  "mcr.microsoft.com",
  "registry.k8s.io",
  "registry.access.redhat.com",
  "docker.elastic.co",
  "nvcr.io",
  "registry.suse.com",
  "harbor.internal",
  "nexus.corp",
  "artifactory.corp",
];

// Sample vulnerabilities for the Trivy security report (semantically plausible, deterministic).
export const VULN_SAMPLES = [
  {
    PkgName: "libssl3",
    InstalledVersion: "3.3.0-r1",
    FixedVersion: "3.3.0-r2",
    Severity: "HIGH",
    Title: "openssl: denial of service via crafted certificate",
  },
  {
    PkgName: "libcrypto3",
    InstalledVersion: "3.3.0-r1",
    FixedVersion: "3.3.0-r2",
    Severity: "HIGH",
    Title: "openssl: buffer overflow in X.509 parsing",
  },
  {
    PkgName: "busybox",
    InstalledVersion: "1.36.1-r0",
    FixedVersion: "1.36.1-r1",
    Severity: "MEDIUM",
    Title: "busybox: out-of-bounds read in awk",
  },
  {
    PkgName: "musl",
    InstalledVersion: "1.2.5-r0",
    FixedVersion: "1.2.5-r1",
    Severity: "MEDIUM",
    Title: "musl: resolver stack overflow",
  },
  {
    PkgName: "zlib",
    InstalledVersion: "1.3.1-r0",
    FixedVersion: "1.3.1-r1",
    Severity: "LOW",
    Title: "zlib: integer overflow in inflate",
  },
  {
    PkgName: "curl",
    InstalledVersion: "8.9.1-r0",
    FixedVersion: "8.10.0-r0",
    Severity: "MEDIUM",
    Title: "curl: cookie injection on redirect",
  },
  {
    PkgName: "pcre2",
    InstalledVersion: "10.43-r0",
    FixedVersion: "10.44-r0",
    Severity: "LOW",
    Title: "pcre2: heap buffer overflow",
  },
  {
    PkgName: "expat",
    InstalledVersion: "2.6.2-r0",
    FixedVersion: "2.6.3-r0",
    Severity: "CRITICAL",
    Title: "expat: XML entity expansion DoS",
  },
];

const LONG_VULN_DESCRIPTION =
  "Mock package vulnerability used for deterministic screenshots. The description intentionally resembles a long Trivy advisory so the security table proves that advisory text wraps inside the Vulnerability ID column, clamps after three lines, and does not stretch the whole report horizontally.";

export function vulnerabilityDescription(index: number): string {
  return index % 2 === 0 ? LONG_VULN_DESCRIPTION : "Mock package vulnerability used for deterministic screenshots.";
}

// Container log line templates (kept non-empty — the streaming adapter test relies on it).
export const LOG_TEMPLATES = [
  "Using configuration from /etc/app/config.yaml",
  "Starting service",
  "Listening on 0.0.0.0",
  "Connected to upstream dependencies",
  "Ready to accept connections",
  "GET /health 200",
  "Background worker tick",
];
