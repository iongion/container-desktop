import { describe, expect, it } from "vitest";

import { demoRegistryTrust } from "./common";

describe("demoRegistryTrust", () => {
  it("gives well-known public registries verify TLS + realistic auth", () => {
    expect(demoRegistryTrust("docker.io", 0, true)).toEqual({
      tls: "verify",
      auth: { kind: "anonymous", rateLimited: true },
    });
    expect(demoRegistryTrust("quay.io", 1, true)).toEqual({ tls: "verify", auth: { kind: "user", account: "ion" } });
    expect(demoRegistryTrust("ghcr.io", 2, true)).toEqual({ tls: "verify", auth: { kind: "pat", account: "ion" } });
  });

  it("marks internal-mirror hosts self-signed on Podman / insecure on Docker, mirroring docker.io", () => {
    const podman = demoRegistryTrust("docker-2.example.com", 0, true);
    expect(podman.tls).toBe("self-signed");
    expect(podman.mirrorOf).toBe("docker.io");

    const docker = demoRegistryTrust("registry.corp.local:5000", 1, false);
    expect(docker.tls).toBe("insecure");
    expect(docker.mirrorOf).toBe("docker.io");
  });

  it("falls back to anonymous for unknown public hosts", () => {
    expect(demoRegistryTrust("public.ecr.aws", 5, true)).toEqual({ tls: "verify", auth: { kind: "anonymous" } });
  });
});
