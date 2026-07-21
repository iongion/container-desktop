import { describe, expect, it } from "vitest";

import { isPrivateIp, shouldOpenExternally } from "@/platform/urlPolicy";

describe("isPrivateIp", () => {
  it("classifies loopback / private / link-local / mapped addresses as private", () => {
    for (const h of ["127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1", "10.0.0.1", "192.168.1.5", "169.254.1.1"]) {
      expect(isPrivateIp(h)).toBe(true);
    }
  });

  it("classifies public addresses and bare hostnames as not-private", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("example.com")).toBe(false); // not an IP literal -> allow-list enforced elsewhere
  });
});

describe("shouldOpenExternally", () => {
  it("allows exact allow-listed URLs", () => {
    expect(shouldOpenExternally("https://container-desktop.com/")).toBe(true);
    expect(shouldOpenExternally("https://container-desktop.com/manual/")).toBe(true);
    expect(shouldOpenExternally("https://github.com/iongion/container-desktop/releases")).toBe(true);
  });

  it("allows allow-listed hostnames and private IPs", () => {
    expect(shouldOpenExternally("https://docs.podman.io/en/latest/")).toBe(true);
    expect(shouldOpenExternally("http://localhost:9090/x")).toBe(true);
    expect(shouldOpenExternally("http://127.0.0.1:8080/api")).toBe(true);
  });

  it("denies arbitrary external domains and malformed URLs", () => {
    expect(shouldOpenExternally("https://evil.example.com/phish")).toBe(false);
    expect(shouldOpenExternally("https://github.com/someone/else")).toBe(false); // not the exact allow-listed URL
    expect(shouldOpenExternally("not a url")).toBe(false);
  });
});
