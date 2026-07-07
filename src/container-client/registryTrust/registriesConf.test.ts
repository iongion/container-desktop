import { describe, expect, it } from "vitest";

import type { RegistryTrustEntry } from "@/env/Types";
import {
  mergeDockerDaemonJson,
  mergeManagedRegistries,
  type PodmanRegistriesConf,
  parsePodmanRegistriesConf,
  stringifyPodmanRegistriesConf,
} from "./registriesConf";

const entry = (over: Partial<RegistryTrustEntry> & { name: string }): RegistryTrustEntry => ({
  tls: "verify",
  order: 0,
  enabled: true,
  ...over,
});

// Round-trip helper: parse → merge → stringify → re-parse, so assertions read the resulting structure.
function applied(text: string, desired: RegistryTrustEntry[], removed: string[] = []): PodmanRegistriesConf {
  const merged = mergeManagedRegistries(parsePodmanRegistriesConf(text), desired, removed);
  return parsePodmanRegistriesConf(stringifyPodmanRegistriesConf(merged));
}

describe("parsePodmanRegistriesConf", () => {
  it("empty/whitespace → {} (valid fresh config)", () => {
    expect(parsePodmanRegistriesConf("")).toEqual({});
    expect(parsePodmanRegistriesConf("   \n ")).toEqual({});
  });
  it("throws on malformed TOML so the orchestration aborts instead of overwriting the user's file", () => {
    expect(() => parsePodmanRegistriesConf("this is = = not toml [[[")).toThrow();
  });
  it("parses array-of-tables registries", () => {
    const conf = parsePodmanRegistriesConf(
      [
        'unqualified-search-registries = ["docker.io"]',
        "",
        "[[registry]]",
        'location = "reg.local"',
        "insecure = true",
      ].join("\n"),
    );
    expect(conf["unqualified-search-registries"]).toEqual(["docker.io"]);
    expect(conf.registry).toEqual([{ location: "reg.local", insecure: true }]);
  });
});

describe("mergeManagedRegistries — PRESERVES unmanaged user/system config (correction #1)", () => {
  const userConf = [
    'unqualified-search-registries = ["docker.io", "quay.io"]',
    "",
    "[[registry]]",
    'location = "user.private.reg"',
    "insecure = true",
    'prefix = "user.private.reg"',
    "",
    "[[registry.mirror]]",
    'location = "user.mirror.reg"',
  ].join("\n");

  it("keeps a user's [[registry]] (and its mirror + unknown keys) when adding an unrelated managed entry", () => {
    const conf = applied(userConf, [entry({ name: "managed.insecure.reg", tls: "insecure", order: 5 })]);
    const user = conf.registry?.find((r) => r.location === "user.private.reg");
    expect(user).toBeDefined();
    expect(user?.insecure).toBe(true);
    expect(user?.prefix).toBe("user.private.reg"); // unknown key survived
    expect(user?.mirror).toEqual([{ location: "user.mirror.reg" }]); // nested user mirror survived
    // The managed entry was added alongside, not replacing.
    expect(conf.registry?.some((r) => r.location === "managed.insecure.reg" && r.insecure === true)).toBe(true);
  });

  it("keeps the user's search registries and appends managed ones", () => {
    const conf = applied(userConf, [entry({ name: "corp.reg", order: 1 })]);
    expect(conf["unqualified-search-registries"]).toEqual(["docker.io", "quay.io", "corp.reg"]);
  });

  it("removing a managed entry deletes ONLY it — the user's entry is untouched", () => {
    // First: user file + a managed entry present.
    const withManaged = mergeManagedRegistries(
      parsePodmanRegistriesConf(userConf),
      [entry({ name: "managed.reg", tls: "insecure" })],
      [],
    );
    // Then: user removes the managed one.
    const after = parsePodmanRegistriesConf(
      stringifyPodmanRegistriesConf(mergeManagedRegistries(withManaged, [], ["managed.reg"])),
    );
    expect(after.registry?.some((r) => r.location === "managed.reg")).toBe(false);
    expect(after.registry?.some((r) => r.location === "user.private.reg")).toBe(true); // user entry preserved
  });
});

describe("mergeManagedRegistries — managed mappings", () => {
  it("insecure TLS → [[registry]] insecure=true; verify TLS removes a bare managed insecure entry", () => {
    const insecure = applied("", [entry({ name: "reg.local", tls: "insecure" })]);
    expect(insecure.registry).toEqual([{ location: "reg.local", insecure: true }]);
    // Flipping back to verify (same location now managed as verify) removes the bare entry.
    const back = applied(
      stringifyPodmanRegistriesConf(
        mergeManagedRegistries(insecure, [entry({ name: "reg.local", tls: "verify" })], []),
      ),
      [],
    );
    expect(back.registry).toBeUndefined();
  });

  it("mirrorOf → target registry gains a [[registry.mirror]]", () => {
    const conf = applied("", [entry({ name: "mirror.local", mirrorOf: "docker.io" })]);
    const target = conf.registry?.find((r) => r.location === "docker.io");
    expect(target?.mirror).toEqual([{ location: "mirror.local" }]);
  });

  it("disabled managed entry is excluded from search registries", () => {
    const conf = applied("", [
      entry({ name: "on.reg", order: 1 }),
      entry({ name: "off.reg", order: 2, enabled: false }),
    ]);
    expect(conf["unqualified-search-registries"]).toEqual(["on.reg"]);
  });
});

describe("mergeDockerDaemonJson", () => {
  it("sets insecure-registries + registry-mirrors, preserving other daemon keys", () => {
    const existing = JSON.stringify({ "log-driver": "json-file", "insecure-registries": ["old"] });
    const out = JSON.parse(
      mergeDockerDaemonJson(existing, [
        entry({ name: "reg.local:5000", tls: "insecure" }),
        entry({ name: "mirror.corp", mirrorOf: "docker.io" }),
      ]),
    );
    expect(out["log-driver"]).toBe("json-file"); // unrelated key preserved
    expect(out["insecure-registries"]).toEqual(["reg.local:5000"]);
    expect(out["registry-mirrors"]).toEqual(["https://mirror.corp"]);
  });
  it("empty input → only managed keys", () => {
    expect(JSON.parse(mergeDockerDaemonJson("", [entry({ name: "r", tls: "insecure" })]))).toEqual({
      "insecure-registries": ["r"],
    });
  });
  it("throws on malformed existing JSON (caller aborts, file preserved)", () => {
    expect(() => mergeDockerDaemonJson("{ not json", [])).toThrow();
  });
});
