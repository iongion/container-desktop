import { describe, expect, it } from "vitest";

import type { SSHHost } from "@/container-client/types/connection";
import { ControllerScopeType } from "@/container-client/types/os";

import { getScopeSelectItemKey } from "./ScopeSelect";

function sshScope(overrides: Partial<SSHHost> = {}): SSHHost {
  return {
    Name: "server-ubuntu2404hu",
    Host: "server-ubuntu2404hu",
    HostName: "192.168.122.52",
    User: "istoica",
    Port: 22,
    IdentityFile: "~/.ssh/id_rsa",
    ConfigHost: "server-ubuntu2404hu",
    Connected: false,
    Usable: false,
    Type: ControllerScopeType.SSHConnection,
    ...overrides,
  };
}

describe("ScopeSelect item keys", () => {
  it("distinguishes scopes with the same display name", () => {
    const first = sshScope();
    const second = sshScope({ HostName: "192.168.122.53" });

    expect(getScopeSelectItemKey(first, 0)).not.toBe(getScopeSelectItemKey(second, 1));
  });

  it("distinguishes duplicate scope entries when all scope fields match", () => {
    const first = sshScope();
    const second = sshScope();

    expect(getScopeSelectItemKey(first, 0)).not.toBe(getScopeSelectItemKey(second, 1));
  });
});
