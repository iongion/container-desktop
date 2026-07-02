import { afterEach, describe, expect, it } from "vitest";
import { type FakeCommandHandle, installFakeCommand } from "@/__tests__/setup/fakeCommand";
import { OperatingSystem } from "@/env/Types";
import { buildSSHArgs, buildSSHTunnelArgs, SSHClient } from "./services";

const params = { host: "10.0.0.5", port: 22, username: "ion", privateKeyPath: "/home/ion/.ssh/id_ed25519" };
const noIdentityParams = { host: "10.0.0.5", port: 22, username: "ion", privateKeyPath: "" };
const configHostParams = { ...params, configHost: "MacOS" };

describe("buildSSHArgs", () => {
  it("is bounded so a control connection cannot hang", () => {
    // BatchMode disables interactive password/host-key prompts; ConnectTimeout +
    // ConnectionAttempts bound the TCP phase. Without these, a wrong key/unreachable host
    // blocks forever on "Please wait".
    const args = buildSSHArgs(params, ["echo", "ok"]);
    expect(args).toContain("-oBatchMode=yes");
    expect(args).toContain("-oConnectTimeout=15");
    expect(args).toContain("-oConnectionAttempts=1");
  });

  it("produces the exact argv: identity, explicit port, target, then the command", () => {
    expect(buildSSHArgs(params, ["echo", "ok"])).toEqual([
      "-oStrictHostKeyChecking=accept-new",
      "-oBatchMode=yes",
      "-oConnectTimeout=15",
      "-oConnectionAttempts=1",
      "-i",
      "/home/ion/.ssh/id_ed25519",
      "-p",
      "22",
      "ion@10.0.0.5",
      "--",
      "echo",
      "ok",
    ]);
  });

  it("omits -i when no identity file is configured so OpenSSH can use agent/default identities", () => {
    const args = buildSSHArgs(noIdentityParams, ["echo", "ok"]);
    expect(args).toEqual([
      "-oStrictHostKeyChecking=accept-new",
      "-oBatchMode=yes",
      "-oConnectTimeout=15",
      "-oConnectionAttempts=1",
      "-p",
      "22",
      "ion@10.0.0.5",
      "--",
      "echo",
      "ok",
    ]);
    expect(args).not.toContain("-i");
  });

  it("uses the SSH config host alias without overriding its configured identity or port", () => {
    expect(buildSSHArgs(configHostParams, ["echo", "ok"])).toEqual([
      "-oStrictHostKeyChecking=accept-new",
      "-oBatchMode=yes",
      "-oConnectTimeout=15",
      "-oConnectionAttempts=1",
      "MacOS",
      "--",
      "echo",
      "ok",
    ]);
  });

  it("passes a non-default port (the dropped -p bug)", () => {
    const args = buildSSHArgs({ ...params, port: 2222 }, ["echo", "ok"]);
    const i = args.indexOf("-p");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("2222");
  });
});

describe("buildSSHTunnelArgs", () => {
  it("uses native ssh target syntax with -p instead of embedding :port in the hostname", () => {
    expect(buildSSHTunnelArgs({ ...params, port: 2222 }, "/tmp/cdt.sock", "/run/podman.sock")).toEqual([
      "-oStrictHostKeyChecking=accept-new",
      "-oBatchMode=yes",
      "-oConnectTimeout=15",
      "-oConnectionAttempts=1",
      "-i",
      "/home/ion/.ssh/id_ed25519",
      "-p",
      "2222",
      "-oExitOnForwardFailure=yes",
      "-oStreamLocalBindUnlink=yes",
      "-NL",
      "/tmp/cdt.sock:/run/podman.sock",
      "ion@10.0.0.5",
    ]);
  });

  it("omits -i for native tunnels when no identity file is configured", () => {
    const args = buildSSHTunnelArgs(noIdentityParams, "/tmp/cdt.sock", "/run/podman.sock");
    expect(args).not.toContain("-i");
    expect(args).toContain("ion@10.0.0.5");
  });

  it("uses the SSH config host alias for native tunnels", () => {
    expect(buildSSHTunnelArgs(configHostParams, "/tmp/cdt.sock", "/run/podman.sock")).toEqual([
      "-oStrictHostKeyChecking=accept-new",
      "-oBatchMode=yes",
      "-oConnectTimeout=15",
      "-oConnectionAttempts=1",
      "-oExitOnForwardFailure=yes",
      "-oStreamLocalBindUnlink=yes",
      "-NL",
      "/tmp/cdt.sock:/run/podman.sock",
      "MacOS",
    ]);
  });
});

describe("SSHClient argv (recorded via fake Command)", () => {
  let fake: FakeCommandHandle;
  afterEach(() => fake?.restore());

  it("connect() runs the bounded probe and marks connected on the sentinel reply", async () => {
    fake = installFakeCommand((call) =>
      call.args.includes("SSH connection established") ? { stdout: "SSH connection established" } : {},
    );
    const client = new SSHClient({ cli: "ssh", osType: OperatingSystem.Linux });
    let established = false;
    client.on("connection.established", () => {
      established = true;
    });

    await client.connect(params);

    expect(fake.calls[0].launcher).toBe("ssh");
    expect(fake.calls[0].args).toEqual(buildSSHArgs(params, ["echo", "SSH connection established"]));
    expect(fake.calls[0].opts?.timeout).toBe(20000);
    expect(established).toBe(true);
    expect(client.isConnected()).toBe(true);
  });

  it("connect() lets OpenSSH use agent/default identities when no identity file is configured", async () => {
    fake = installFakeCommand((call) =>
      call.args.includes("SSH connection established") ? { stdout: "SSH connection established" } : {},
    );
    const client = new SSHClient({ cli: "ssh", osType: OperatingSystem.Linux });

    await client.connect(noIdentityParams);

    expect(fake.calls[0].args).toEqual(buildSSHArgs(noIdentityParams, ["echo", "SSH connection established"]));
    expect(fake.calls[0].args).not.toContain("-i");
    expect(client.isConnected()).toBe(true);
  });

  it("execute() reuses the same bounded argv with the requested command", async () => {
    fake = installFakeCommand();
    const client = new SSHClient({ cli: "ssh", osType: OperatingSystem.Linux });
    await client.connect(params);
    fake.calls.length = 0;

    await client.execute(["podman", "info"]);

    expect(fake.calls[0].args).toEqual(buildSSHArgs(params, ["podman", "info"]));
    expect(fake.calls[0].opts?.timeout).toBe(20000);
  });

  it("connect() failure attaches a structured preflight report, not just raw output (#186/#171)", async () => {
    // Make the probe fail; connect() then runs the (bounded) preflight to diagnose why.
    fake = installFakeCommand((call) => (call.args.includes("echo") ? { success: false, stderr: "boom" } : {}));
    const client = new SSHClient({ cli: "ssh", osType: OperatingSystem.Linux });
    let payload: any;
    client.on("error", (e) => {
      payload = e;
    });

    await client.connect(params);

    expect(client.isConnected()).toBe(false);
    // The emitted error carries both the raw output AND a structured report with a concrete reason.
    expect(payload?.output).toBeDefined();
    expect(payload?.report?.ok).toBe(false);
    expect(payload.report.steps.some((s: { skipped: boolean; ok: boolean }) => !s.skipped && !s.ok)).toBe(true);
  });

  it("startTunnel() on Linux spawns native ssh -NL using the shared bounded target argv", async () => {
    fake = installFakeCommand();
    const client = new SSHClient({ cli: "ssh", osType: OperatingSystem.Linux });
    await client.connect(params);
    fake.calls.length = 0;

    await client.startTunnel({
      localAddress: "/tmp/cdt.sock",
      remoteAddress: "unix:///run/podman.sock",
      onStatusCheck: () => {},
      onStopTunnel: () => {},
    });

    const bg = fake.calls.find((c) => c.args.includes("-NL"));
    expect(bg).toBeDefined();
    expect(bg?.args).toEqual(buildSSHTunnelArgs(params, "/tmp/cdt.sock", "/run/podman.sock"));
  });
});
