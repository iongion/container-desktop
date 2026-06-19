// adapters/shared.ts — the ResourceAdapter base class + the active-host accessor shared by every adapter.
//
// Each per-resource adapter is a class over the active HostClient's raw Axios driver
// (HostClient.getApiDriver()). Engine differences are confined to two encapsulated seams on the base:
// the per-call baseURL (libpod-compat vs docker root) and the per-engine normalizer set. There is NO
// inline `if (engine === DOCKER)` shape branching in shared code — shape lives in the per-engine
// normalizers; the few genuine endpoint-PATH differences (volumes, networks) live in the owning adapter.

import type { AxiosInstance, AxiosResponse } from "axios";

import { Application } from "@/container-client/Application";
import { dockerNormalizers } from "@/container-client/normalizers/docker";
import { podmanNormalizers } from "@/container-client/normalizers/podman";
import type { EngineNormalizers } from "@/container-client/normalizers/shared";
import type { HostClientFacade } from "@/container-client/runtimes/facade";

/** libpod (Podman) compat root — byte-for-byte from Api.clients.ts (e.g. :808). */
export const LIBPOD_BASE_URL = "http://d/v4.0.0/libpod";
/** Docker root — byte-for-byte from Api.clients.ts (e.g. :573). */
export const DOCKER_BASE_URL = "http://localhost";

/** The active host facade for the current connection (Application.ts:898 — returns HostClientFacade). */
export function getActiveHostClient(): HostClientFacade {
  return Application.getInstance().getCurrentEngineConnectionApi();
}

/** Base for every per-resource adapter: binds the host and encapsulates the driver/engine seams. */
export abstract class ResourceAdapter {
  private driverPromise?: Promise<AxiosInstance>;

  constructor(protected readonly host: HostClientFacade = getActiveHostClient()) {}

  /** The active host's raw Axios driver — one instance per adapter, created on first use. */
  protected driver(): Promise<AxiosInstance> {
    this.driverPromise ??= this.host.getApiDriver();
    return this.driverPromise;
  }

  /** True when the host speaks the Docker REST surface (Docker-native or Docker-compatible like Apple-socktainer). */
  protected get usesDockerApi(): boolean {
    return this.host.apiSurface === "docker";
  }

  /**
   * Per-call baseURL for resources that explicitly target the libpod-compat vs docker root (volumes,
   * secrets, networks, pods, container/pod creation). Keyed on apiSurface, not engine identity —
   * Apple (apiSurface "docker") gets DOCKER_BASE_URL, same as Docker itself.
   */
  protected get baseURL(): string {
    return this.usesDockerApi ? DOCKER_BASE_URL : LIBPOD_BASE_URL;
  }

  /** The per-engine normalizer set for the active host (symmetric — both engines implement the full surface). */
  protected get normalizers(): EngineNormalizers {
    return this.usesDockerApi ? dockerNormalizers : podmanNormalizers;
  }

  /** 2xx check — lifted from Api.clients.ts:206 (the monolith keeps its copy until the Phase 5 cutover). */
  protected isOk(response: AxiosResponse): boolean {
    return response.status >= 200 && response.status < 300;
  }
}
