import { describe, expect, it } from "vitest";

import { dockerNormalizers } from "@/container-client/normalizers/docker";
import { podmanNormalizers } from "@/container-client/normalizers/podman";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { ContainerEngine } from "@/env/Types";
import { DOCKER_BASE_URL, LIBPOD_BASE_URL, ResourceAdapter } from "./shared";

// Exposes the protected engine seams so we can assert them directly.
class ProbeAdapter extends ResourceAdapter {
  get probe() {
    return { usesDockerApi: this.usesDockerApi, baseURL: this.baseURL, normalizers: this.normalizers };
  }
}

function fakeHost(apiSurface: "docker" | "libpod", engine: ContainerEngine): HostClientFacade {
  return { apiSurface, ENGINE: engine } as unknown as HostClientFacade;
}

describe("ResourceAdapter engine seam — keyed on apiSurface, not engine identity", () => {
  it("Apple host (apiSurface docker) uses the Docker REST surface — proves it is NOT treated as libpod", () => {
    const { usesDockerApi, baseURL, normalizers } = new ProbeAdapter(fakeHost("docker", ContainerEngine.APPLE)).probe;
    expect(usesDockerApi).toBe(true);
    expect(baseURL).toBe(DOCKER_BASE_URL);
    expect(normalizers).toBe(dockerNormalizers);
  });

  it("Docker host uses the Docker REST surface", () => {
    const { usesDockerApi, baseURL } = new ProbeAdapter(fakeHost("docker", ContainerEngine.DOCKER)).probe;
    expect(usesDockerApi).toBe(true);
    expect(baseURL).toBe(DOCKER_BASE_URL);
  });

  it("Podman host (apiSurface libpod) uses the libpod surface", () => {
    const { usesDockerApi, baseURL, normalizers } = new ProbeAdapter(fakeHost("libpod", ContainerEngine.PODMAN)).probe;
    expect(usesDockerApi).toBe(false);
    expect(baseURL).toBe(LIBPOD_BASE_URL);
    expect(normalizers).toBe(podmanNormalizers);
  });
});
