import { describe, expect, it, vi } from "vitest";

import { credentialsFromHost, startSSHConnection } from "./ssh-transport";

const CONFIG_HOST = {
  Name: "prod",
  Host: "prod",
  Port: 2222,
  HostName: "10.0.0.1",
  User: "deploy",
  IdentityFile: "~/.ssh/id_ed25519",
  ConfigHost: "prod",
  Type: "SSHConnection",
} as any;

// The exact ssh argv for a config-derived host: -i/-p are DROPPED (configHost trusted), target is the alias.
const PROBE_ARGS = [
  "-oStrictHostKeyChecking=accept-new",
  "-oBatchMode=yes",
  "-oConnectTimeout=15",
  "-oConnectionAttempts=1",
  "prod",
  "--",
  "echo",
  "SSH connection established",
];

const okProbe = { pid: 0, success: true, stdout: "SSH connection established\n", stderr: "", code: 0 };

describe("credentialsFromHost", () => {
  it("maps SSHHost → SSHClientConnection (HostName/Host/Name fallback, port/user defaults, configHost)", () => {
    expect(credentialsFromHost(CONFIG_HOST)).toEqual({
      host: "10.0.0.1",
      port: 2222,
      username: "deploy",
      privateKeyPath: "~/.ssh/id_ed25519",
      configHost: "prod",
    });
    // fallbacks: no HostName → Host → Name; no Port → 22; no User → ""
    expect(credentialsFromHost({ Name: "box", Host: "box", Port: 0, HostName: "", User: "" } as any)).toMatchObject({
      host: "box",
      port: 22,
      username: "",
    });
  });
});

describe("startSSHConnection", () => {
  it("runs the echo connect-probe with the config-host ssh argv and returns a connected client", async () => {
    const execute = vi.fn(async () => okProbe);
    const executeStreaming = vi.fn(async () => ({}) as any);
    const client = await startSSHConnection({ execute, executeStreaming, osType: "Linux" }, CONFIG_HOST);
    expect(execute).toHaveBeenCalledWith("ssh", PROBE_ARGS, { timeout: 20000 });
    expect(client.isConnected()).toBe(true);
  });

  it("uses ssh.exe on Windows", async () => {
    const execute = vi.fn(async () => okProbe);
    await startSSHConnection({ execute, executeStreaming: vi.fn(), osType: "Windows_NT" }, CONFIG_HOST);
    expect(execute).toHaveBeenCalledWith("ssh.exe", PROBE_ARGS, { timeout: 20000 });
  });

  it("execute() and executeStreaming() run `ssh <alias> -- <command>` over the Command port", async () => {
    const execute = vi.fn(async () => okProbe);
    const executeStreaming = vi.fn(async () => ({ on() {}, off() {}, dispose() {}, kill() {} }) as any);
    const client = await startSSHConnection({ execute, executeStreaming, osType: "Linux" }, CONFIG_HOST);
    await client.execute(["podman", "ps"]);
    expect(execute).toHaveBeenLastCalledWith(
      "ssh",
      [...PROBE_ARGS.slice(0, 5), "--", "podman", "ps"],
      expect.anything(),
    );
    await client.executeStreaming(["podman", "logs", "-f", "x"]);
    expect(executeStreaming).toHaveBeenCalledWith("ssh", [
      ...PROBE_ARGS.slice(0, 5),
      "--",
      "podman",
      "logs",
      "-f",
      "x",
    ]);
  });

  it("throws with the stderr reason when the probe fails, and never returns a client", async () => {
    const execute = vi.fn(async () => ({
      pid: 0,
      success: false,
      stdout: "",
      stderr: "Permission denied (publickey).",
      code: 255,
    }));
    await expect(
      startSSHConnection({ execute, executeStreaming: vi.fn(), osType: "Linux" }, CONFIG_HOST),
    ).rejects.toThrow("Permission denied (publickey).");
  });

  it("treats wrong stdout as a failed probe (guards the exact sentinel)", async () => {
    const execute = vi.fn(async () => ({ pid: 0, success: true, stdout: "some banner text", stderr: "", code: 0 }));
    await expect(
      startSSHConnection({ execute, executeStreaming: vi.fn(), osType: "Linux" }, CONFIG_HOST),
    ).rejects.toThrow();
  });

  it("close() marks the client disconnected", async () => {
    const client = await startSSHConnection(
      { execute: vi.fn(async () => okProbe), executeStreaming: vi.fn(), osType: "Linux" },
      CONFIG_HOST,
    );
    expect(client.isConnected()).toBe(true);
    client.close();
    expect(client.isConnected()).toBe(false);
  });
});
