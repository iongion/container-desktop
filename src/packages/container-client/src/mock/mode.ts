// Mock-mode gate. When enabled, the data/communication layer is served from deterministic
// per-engine fixtures (see ./fixtures) instead of a real container engine — used to regenerate
// the documentation screenshots and to run hermetic UI integration tests (no podman/docker needed).
//
// Switched on by the `CONTAINER_DESKTOP_MOCK` env var (read from process.env in main/preload, and
// from the contextBridge-exposed global in the renderer). Values: "podman" | "docker" | "container"
// boot that single engine as the current connection; "unified" | "all" | "both" | "1" | "true" |
// "yes" boot ALL system engines connected → the merged/unified workspace. ALWAYS inert in production
// builds —
// the value is ignored when ENVIRONMENT === "production" — so a stray flag can never make a shipped
// app serve fixtures.

import { ContainerEngine } from "@/container-client/types/engine";

export type MockEngine = ContainerEngine.PODMAN | ContainerEngine.DOCKER | ContainerEngine.APPLE;

// Values that boot the multi-engine (merged) workspace. "1"/"true"/"yes" are kept for back-compat
// (historically documented as "boots Podman+Docker mocks") and now alias the explicit "unified".
const MULTI_ENGINE_FLAGS = new Set(["1", "true", "yes", "unified", "all", "both"]);

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
  // renderer → exposed via contextBridge in preload (platform/electron/preload.ts).
  const exposed = (globalThis as unknown as { CONTAINER_DESKTOP_MOCK?: string }).CONTAINER_DESKTOP_MOCK;
  return `${exposed ?? ""}`;
}

// Read a mock-only env flag with the same guarded strategy as the mock gate: process.env in main/preload, the
// contextBridge-exposed global in the renderer, "" otherwise. The single guarded `process` read for mock config
// lives HERE so the mock sites (connections / mockApiAdapter / generator) stay node-free. Not production-gated —
// callers already run only in mock mode.
export function mockEnvValue(name: string): string {
  if (typeof process !== "undefined" && process.env?.[name]) {
    return `${process.env[name]}`;
  }
  const exposed = (globalThis as unknown as Record<string, string | undefined>)[name];
  return `${exposed ?? ""}`;
}

// True when the app should serve fixtures instead of talking to a real engine.
export function isMockMode(): boolean {
  const value = rawFlag().toLowerCase();
  return MULTI_ENGINE_FLAGS.has(value) || value === "podman" || value === "docker" || value === "container";
}

// The engines the mock boots as auto-start (connected) connections: a single engine for
// "podman"/"docker", or both for the multi-engine flags ("unified" etc.). Drives which system
// connections auto-start at boot (see ./connections) — and therefore whether the app lands in the
// single-engine or the merged/unified workspace. Empty when not in mock mode.
export function getMockEngines(): MockEngine[] {
  const value = rawFlag().toLowerCase();
  if (value === "docker") {
    return [ContainerEngine.DOCKER];
  }
  if (value === "podman") {
    return [ContainerEngine.PODMAN];
  }
  if (value === "container") {
    return [ContainerEngine.APPLE];
  }
  if (MULTI_ENGINE_FLAGS.has(value)) {
    return [ContainerEngine.PODMAN, ContainerEngine.DOCKER, ContainerEngine.APPLE];
  }
  return [];
}

// True when the mock boots more than one engine — i.e. the merged/unified workspace.
export function isUnifiedMock(): boolean {
  return getMockEngines().length > 1;
}

// The primary engine (the default current connection). Defaults to podman.
export function getMockEngine(): MockEngine {
  return getMockEngines()[0] ?? ContainerEngine.PODMAN;
}
