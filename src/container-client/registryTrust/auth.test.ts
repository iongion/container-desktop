import { describe, expect, it } from "vitest";

import { buildLoginArgs, buildLogoutArgs } from "./auth";

describe("buildLoginArgs", () => {
  it("uses --password-stdin and never places the secret in argv", () => {
    const args = buildLoginArgs("registry.example.com", "alice");
    expect(args).toEqual(["login", "registry.example.com", "--username", "alice", "--password-stdin"]);
    // The password/token is delivered via stdin (HostExecOptions.input), so it can never appear here.
    expect(args.join(" ")).not.toContain("--password ");
    expect(args).not.toContain("-p");
  });

  it("appends --tls-verify=false only when tlsVerify is explicitly false (podman insecure)", () => {
    expect(buildLoginArgs("reg.local:5000", "bob", { tlsVerify: false })).toEqual([
      "login",
      "reg.local:5000",
      "--username",
      "bob",
      "--password-stdin",
      "--tls-verify=false",
    ]);
    // Undefined / true → no flag (default verify).
    expect(buildLoginArgs("reg.local:5000", "bob", { tlsVerify: true })).not.toContain("--tls-verify=false");
    expect(buildLoginArgs("reg.local:5000", "bob")).not.toContain("--tls-verify=false");
  });
});

describe("buildLogoutArgs", () => {
  it("logs out of a single registry", () => {
    expect(buildLogoutArgs("registry.example.com")).toEqual(["logout", "registry.example.com"]);
  });
});
