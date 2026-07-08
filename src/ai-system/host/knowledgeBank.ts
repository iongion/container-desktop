// Diagnostic knowledge bank. A small JSON store seeded with built-in
// Podman/Docker/WSL/SSH solutions. The diagnostic agent searches it for known fixes as silent
// grounding (the `searchKnowledge` tool) — it has NO renderer-facing surface and is read-only.
// Storage is a port so the bank is unit-testable without the filesystem; createAISystem wires the
// file-backed store via runtimes/knowledgeFileStorage over the app FS port.
// No Electron/AI-SDK/node:* imports.

import type { KnowledgeDomain, KnowledgeEntry } from "@/ai-system/core";
import i18n from "@/i18n";

export type { KnowledgeDomain, KnowledgeEntry };

export interface KnowledgeBankData {
  version: number;
  entries: KnowledgeEntry[];
}

export interface KnowledgeStorage {
  load(): Promise<KnowledgeBankData | null>;
  save(data: KnowledgeBankData): Promise<void>;
}

// Built-in solutions. Kept terse and practical; the agent uses them as grounding, not gospel.
const BUILTIN_SEED: KnowledgeEntry[] = [
  {
    id: "podman-rootless-socket",
    domain: "podman",
    title: i18n.t("Rootless Podman API socket not available"),
    symptom: i18n.t("Cannot connect to Podman socket / unix:///run/user/<uid>/podman/podman.sock no such file"),
    solution: i18n.t(
      "Enable the user API service so the rootless socket exists, then point clients at it via DOCKER_HOST.",
    ),
    commands: ["systemctl --user enable --now podman.socket", "systemctl --user status podman.socket"],
    tags: ["socket", "rootless", "connection", "DOCKER_HOST"],
  },
  {
    id: "podman-shortname",
    domain: "podman",
    title: i18n.t("Short-name image did not resolve"),
    symptom: i18n.t("Error: short-name resolution / image name is ambiguous when pulling"),
    solution: i18n.t(
      "Use a fully-qualified image reference (registry/namespace/name:tag) instead of a bare short name.",
    ),
    commands: ["podman pull docker.io/library/alpine:latest"],
    tags: ["pull", "registry", "short-name", "image"],
  },
  {
    id: "docker-daemon-connection",
    domain: "docker",
    title: i18n.t("Cannot connect to the Docker daemon"),
    symptom: i18n.t(
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
    ),
    solution: i18n.t(
      "Start the Docker service (or Docker Desktop) and verify it is listening; check DOCKER_HOST is not pointing elsewhere.",
    ),
    commands: ["systemctl --user status docker", "docker version"],
    tags: ["daemon", "socket", "connection", "permission denied"],
  },
  {
    id: "docker-socket-permission",
    domain: "docker",
    title: i18n.t("Permission denied on the Docker socket"),
    symptom: i18n.t("permission denied while trying to connect to the Docker daemon socket /var/run/docker.sock"),
    solution: i18n.t(
      "Add your user to the docker group (then re-login), or use a rootless engine. Avoid chmod 777 on the socket.",
    ),
    commands: ["sudo usermod -aG docker $USER"],
    tags: ["permission denied", "socket", "group", "rootless"],
  },
  {
    id: "wsl-distro-not-running",
    domain: "wsl",
    title: i18n.t("WSL distribution not running / stale state"),
    symptom: i18n.t("WSL: the distribution is stopped, hangs, or the engine inside WSL is unreachable"),
    solution: i18n.t(
      "List distros and their state, then restart WSL to clear stuck state before starting the engine again.",
    ),
    commands: ["wsl -l -v", "wsl --shutdown"],
    tags: ["wsl", "distribution", "restart", "stopped"],
  },
  {
    id: "wsl-docker-integration",
    domain: "wsl",
    title: i18n.t("Docker not visible inside WSL"),
    symptom: i18n.t("docker command works on Windows but not inside the WSL distro"),
    solution: i18n.t(
      "Enable Docker Desktop WSL integration for the distro (Settings → Resources → WSL integration), or run a native engine inside WSL.",
    ),
    tags: ["wsl", "docker desktop", "integration"],
  },
  {
    id: "ssh-publickey-denied",
    domain: "ssh",
    title: i18n.t("SSH Permission denied (publickey)"),
    symptom: i18n.t("Permission denied (publickey) when connecting to a remote engine over SSH"),
    solution: i18n.t(
      "Confirm the right IdentityFile is offered and the key is loaded in the agent; verify the public key is in the remote authorized_keys.",
    ),
    commands: ["ssh-add -l", "ssh -v <host>"],
    tags: ["ssh", "publickey", "identity", "auth"],
  },
  {
    id: "ssh-host-key-changed",
    domain: "ssh",
    title: i18n.t("SSH host key verification failed"),
    symptom: i18n.t("Host key verification failed / REMOTE HOST IDENTIFICATION HAS CHANGED"),
    solution: i18n.t(
      "If the host legitimately changed, remove the stale known_hosts entry and reconnect to accept the new key.",
    ),
    commands: ["ssh-keygen -R <host>"],
    tags: ["ssh", "known_hosts", "host key"],
  },
];

const tokenize = (s: string): string[] => s.toLowerCase().match(/[a-z0-9_./-]{2,}/g) ?? [];

export class KnowledgeBank {
  private data: KnowledgeBankData = { version: 1, entries: [] };
  private loaded = false;

  constructor(private readonly deps: { storage: KnowledgeStorage; seed?: KnowledgeEntry[] }) {}

  async init(): Promise<void> {
    const existing = await this.deps.storage.load();
    if (existing && Array.isArray(existing.entries) && existing.entries.length > 0) {
      this.data = existing;
      this.loaded = true;
      return;
    }
    const seed = this.deps.seed ?? BUILTIN_SEED;
    this.data = { version: 1, entries: seed.map((e) => ({ ...e })) };
    this.loaded = true;
    await this.deps.storage.save(this.data);
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.init();
    }
  }

  // Rank by query-term overlap. Read-only — there is no feedback/score machinery.
  async search(query: string): Promise<KnowledgeEntry[]> {
    await this.ensureLoaded();
    const terms = new Set(tokenize(query));
    if (terms.size === 0) {
      return [];
    }
    const scored = this.data.entries
      .map((e) => {
        const haystack = tokenize(`${e.title} ${e.symptom} ${e.solution} ${(e.tags ?? []).join(" ")}`);
        let overlap = 0;
        for (const term of haystack) {
          if (terms.has(term)) {
            overlap += 1;
          }
        }
        return { entry: e, overlap };
      })
      .filter((x) => x.overlap > 0);
    scored.sort((a, b) => b.overlap - a.overlap);
    return scored.map((x) => ({ ...x.entry }));
  }
}
