// Mock-mode gate. When enabled, the data/communication layer is served from deterministic
// per-engine fixtures (see ./fixtures) instead of a real container engine — used to regenerate
// the documentation screenshots and to run hermetic UI integration tests (no podman/docker needed).
//
// Switched on by the `CONTAINER_DESKTOP_MOCK` env var (read from process.env in main/preload, and
// from the contextBridge-exposed global in the renderer). Values: "podman" | "docker" boot that
// engine as the current connection; "1"/"true"/"yes" default to podman. ALWAYS inert in production
// builds — the value is ignored when ENVIRONMENT === "production" — so a stray flag can never make a
// shipped app serve fixtures.

import { ContainerEngine } from "@/env/Types";

export type MockEngine = ContainerEngine.PODMAN | ContainerEngine.DOCKER;

function rawFlag(): string {
  // Production is never mockable, regardless of the env var (compile-time constant — lets the
  // bundler drop the fixture graph from production output, see ./fixturesLoader).
  if (import.meta.env.ENVIRONMENT === "production") {
    return "";
  }
  // main + preload run with Node integration → process.env is available.
  if (typeof process !== "undefined" && process.env?.CONTAINER_DESKTOP_MOCK) {
    return `${process.env.CONTAINER_DESKTOP_MOCK}`;
  }
  // renderer → exposed via contextBridge in preload (electron-shell/preload.ts).
  const exposed = (globalThis as unknown as { CONTAINER_DESKTOP_MOCK?: string }).CONTAINER_DESKTOP_MOCK;
  return `${exposed ?? ""}`;
}

/** True when the app should serve fixtures instead of talking to a real engine. */
export function isMockMode(): boolean {
  const value = rawFlag().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "podman" || value === "docker";
}

/** Which engine the mock app boots into (the default current connection). Defaults to podman. */
export function getMockEngine(): MockEngine {
  return rawFlag().toLowerCase() === "docker" ? ContainerEngine.DOCKER : ContainerEngine.PODMAN;
}
