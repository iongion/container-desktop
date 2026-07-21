import { describe, expect, it } from "vitest";

import { ContainerEngine } from "@/container-client/types/engine";
import { buildCaInstallCommand, buildCaRemoveCommand, caCertTarget } from "./certsd";

const podman = { engine: ContainerEngine.PODMAN, rootfull: false, home: "/home/alice" };
const apple = { engine: ContainerEngine.APPLE, rootfull: false, home: "/home/alice" };

describe("caCertTarget", () => {
  it("resolves the certs.d dir + ca.crt for podman", () => {
    expect(caCertTarget(podman, "reg.local:5000")).toEqual({
      dir: "/home/alice/.config/containers/certs.d/reg.local:5000",
      file: "/home/alice/.config/containers/certs.d/reg.local:5000/ca.crt",
    });
  });
  it("undefined for Apple (no certs.d surface)", () => {
    expect(caCertTarget(apple, "reg.local")).toBeUndefined();
  });
});

describe("buildCaInstallCommand", () => {
  const target = { dir: "/etc/docker/certs.d/reg.local", file: "/etc/docker/certs.d/reg.local/ca.crt" };

  it("pipes the PEM via stdin (cat > file), never argv", () => {
    const cmd = buildCaInstallCommand(target);
    expect(cmd.launcher).toBe("sh");
    expect(cmd.args).toEqual([
      "-c",
      "mkdir -p '/etc/docker/certs.d/reg.local' && cat > '/etc/docker/certs.d/reg.local/ca.crt'",
    ]);
    // No PEM/cert bytes appear in the command — they arrive on stdin.
    expect(JSON.stringify(cmd)).not.toContain("BEGIN CERTIFICATE");
  });

  it("wraps with sudo for root-owned guest dirs", () => {
    const cmd = buildCaInstallCommand(target, { sudo: true });
    expect(cmd.launcher).toBe("sudo");
    expect(cmd.args[0]).toBe("sh");
  });

  it("single-quotes paths so an odd host can't break the shell", () => {
    const cmd = buildCaInstallCommand({ dir: "/x/a b", file: "/x/a b/ca.crt" });
    expect(cmd.args[1]).toContain("'/x/a b'");
  });
});

describe("buildCaRemoveCommand", () => {
  it("rm -f the ca.crt", () => {
    const cmd = buildCaRemoveCommand({ dir: "/d", file: "/d/ca.crt" });
    expect(cmd.args).toEqual(["-c", "rm -f '/d/ca.crt'"]);
  });
});
