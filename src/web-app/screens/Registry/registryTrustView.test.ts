import { describe, expect, it } from "vitest";

import type { Registry, RegistryTlsState } from "@/container-client/types/registry";
import {
  isPrivateRegistry,
  type RegistryRow,
  registryAuthLabel,
  registryTrustView,
  sortRegistryRows,
} from "./registryTrustView";

const base: Registry = {
  id: "docker.io",
  name: "docker.io",
  created: "2026-01-01T00:00:00.000Z",
  weight: 0,
  enabled: true,
  isRemovable: true,
  isSystem: false,
  engine: [],
};

describe("registryTrustView", () => {
  it("falls back to honest defaults when trust fields are absent (real connections until wired)", () => {
    expect(registryTrustView(base, 0)).toEqual({
      tls: "verify",
      auth: { kind: "anonymous" },
      mirrorOf: undefined,
      order: 1,
      loggedIn: false,
    });
  });

  it("passes through populated trust fields and derives 1-based order", () => {
    const view = registryTrustView(
      { ...base, tls: "self-signed", auth: { kind: "pat", account: "ion" }, mirrorOf: "docker.io" },
      3,
    );
    expect(view).toEqual({
      tls: "self-signed",
      auth: { kind: "pat", account: "ion" },
      mirrorOf: "docker.io",
      order: 4,
      loggedIn: true,
    });
  });

  it("treats anonymous (even rate-limited) as logged out, any account kind as logged in", () => {
    expect(registryTrustView({ ...base, auth: { kind: "anonymous", rateLimited: true } }, 0).loggedIn).toBe(false);
    expect(registryTrustView({ ...base, auth: { kind: "robot", account: "ci" } }, 0).loggedIn).toBe(true);
  });
});

describe("isPrivateRegistry", () => {
  it("treats well-known public registries as not private", () => {
    expect(isPrivateRegistry("docker.io")).toBe(false);
    expect(isPrivateRegistry("quay.io")).toBe(false);
    expect(isPrivateRegistry("ghcr.io")).toBe(false);
  });

  it("treats ported / internal / corp hosts as private", () => {
    expect(isPrivateRegistry("registry.corp.local:5000")).toBe(true);
    expect(isPrivateRegistry("harbor.internal:443")).toBe(true);
    expect(isPrivateRegistry("registry.corp.local")).toBe(true);
    expect(isPrivateRegistry("nexus.example.com")).toBe(false);
  });
});

describe("registryAuthLabel", () => {
  it("renders the mockup auth vocabulary", () => {
    expect(registryAuthLabel({ kind: "anonymous" })).toBe("anonymous");
    expect(registryAuthLabel({ kind: "anonymous", rateLimited: true })).toBe("anonymous · rate-limited");
    expect(registryAuthLabel({ kind: "user", account: "ion" })).toBe("ion");
    expect(registryAuthLabel({ kind: "pat", account: "ion" })).toBe("PAT · ion");
    expect(registryAuthLabel({ kind: "robot", account: "ci" })).toBe("robot · ci");
  });
});

describe("sortRegistryRows", () => {
  const mk = (name: string, order: number, tls: RegistryTlsState): RegistryRow => ({
    registry: { ...base, id: name, name },
    view: { tls, auth: { kind: "anonymous" }, order, loggedIn: false },
  });
  const rows = [mk("quay.io", 2, "verify"), mk("docker.io", 1, "insecure"), mk("ghcr.io", 3, "self-signed")];

  it("keeps fetched order when unsorted", () => {
    expect(sortRegistryRows(rows, undefined).map((r) => r.registry.name)).toEqual(["quay.io", "docker.io", "ghcr.io"]);
  });

  it("sorts by registry name asc and desc", () => {
    expect(sortRegistryRows(rows, { field: "registry", dir: "asc" }).map((r) => r.registry.name)).toEqual([
      "docker.io",
      "ghcr.io",
      "quay.io",
    ]);
    expect(sortRegistryRows(rows, { field: "registry", dir: "desc" }).map((r) => r.registry.name)).toEqual([
      "quay.io",
      "ghcr.io",
      "docker.io",
    ]);
  });

  it("sorts by order numerically and by TLS severity (verify < self-signed < insecure)", () => {
    expect(sortRegistryRows(rows, { field: "order", dir: "asc" }).map((r) => r.view.order)).toEqual([1, 2, 3]);
    expect(sortRegistryRows(rows, { field: "tls", dir: "asc" }).map((r) => r.view.tls)).toEqual([
      "verify",
      "self-signed",
      "insecure",
    ]);
  });
});
