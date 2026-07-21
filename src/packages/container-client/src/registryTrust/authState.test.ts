import { describe, expect, it } from "vitest";

import { isDockerHub, isRegistryLoggedIn, mockRegistryLoginState } from "./authState";

describe("isDockerHub", () => {
  it("recognizes the Hub aliases and a bare (implicit) reference", () => {
    for (const ref of ["docker.io", "index.docker.io", "registry-1.docker.io", "https://index.docker.io/v1/", ""]) {
      expect(isDockerHub(ref)).toBe(true);
    }
  });
  it("treats other hosts as not Hub", () => {
    for (const ref of ["ghcr.io", "quay.io", "registry.example.com:5000"]) {
      expect(isDockerHub(ref)).toBe(false);
    }
  });
});

describe("isRegistryLoggedIn", () => {
  it("returns not-logged-in for empty / malformed / missing auths", () => {
    expect(isRegistryLoggedIn("", "docker.io").loggedIn).toBe(false);
    expect(isRegistryLoggedIn("not json", "docker.io").loggedIn).toBe(false);
    expect(isRegistryLoggedIn(JSON.stringify({ auths: {} }), "docker.io").loggedIn).toBe(false);
  });

  it("matches Docker Hub stored under the docker v1 URL key and decodes the account from the auth blob", () => {
    const config = JSON.stringify({ auths: { "https://index.docker.io/v1/": { auth: btoa("alice:token") } } });
    const state = isRegistryLoggedIn(config, "docker.io");
    expect(state.loggedIn).toBe(true);
    expect(state.account).toBe("alice");
  });

  it("matches Docker Hub stored under the bare podman key", () => {
    expect(isRegistryLoggedIn(JSON.stringify({ auths: { "docker.io": {} } }), "index.docker.io").loggedIn).toBe(true);
  });

  it("matches a non-Hub registry stored bare or with a scheme, and prefers the username field", () => {
    expect(isRegistryLoggedIn(JSON.stringify({ auths: { "ghcr.io": { username: "bob" } } }), "ghcr.io")).toEqual({
      loggedIn: true,
      account: "bob",
    });
    expect(isRegistryLoggedIn(JSON.stringify({ auths: { "https://ghcr.io": {} } }), "ghcr.io").loggedIn).toBe(true);
  });

  it("counts a credential helper as logged in (no inline blob to decode)", () => {
    const state = isRegistryLoggedIn(JSON.stringify({ credHelpers: { "ghcr.io": "gh" } }), "ghcr.io");
    expect(state).toEqual({ loggedIn: true });
  });

  it("counts a credsStore-backed key with an empty blob as logged in", () => {
    expect(isRegistryLoggedIn(JSON.stringify({ auths: { "quay.io": {} } }), "quay.io").loggedIn).toBe(true);
  });

  it("does not match an unrelated registry", () => {
    expect(isRegistryLoggedIn(JSON.stringify({ auths: { "ghcr.io": {} } }), "quay.io").loggedIn).toBe(false);
  });
});

describe("mockRegistryLoginState", () => {
  it("always reports not-logged-in so the mock auth-required flow shows the sign-in CTA", () => {
    expect(mockRegistryLoginState("docker.io")).toEqual({ loggedIn: false });
  });
});
