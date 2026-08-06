import { describe, expect, it, vi } from "vitest";
import { SSHTransport } from "@/container-client/runtimes/transports/ssh";

// The one thing a reconnect needs from outside: that `~/.ssh/config` still has the scope's entry. Stubbed rather than
// read, so these tests say nothing about the machine they run on.
vi.mock("@/container-client/shared", () => ({
  getAvailableSSHConnections: async () => [{ Name: "win11", Host: "win11", Port: 22, User: "me", IdentityFile: "" }],
}));

// A minimal ISSHClient stand-in that records the argv it is asked to run over the SSH connection.
const fakeConnection = (calls: string[][]) =>
  ({
    isConnected: () => true,
    execute: async (argv: string[]) => {
      calls.push(argv);
      return { pid: 1, code: 0, success: true, stdout: "[]", stderr: "" };
    },
    executeStreaming: async (argv: string[]) => {
      calls.push(argv);
      return { on: () => {}, off: () => {}, dispose: () => {}, kill: () => {} };
    },
  }) as any;

const transportWith = (calls: string[][]) => {
  const t = new SSHTransport();
  (t as any)._connection = fakeConnection(calls);
  return t;
};

// A client that is CLOSED — what the app leaves behind when it stops the API of a connection whose engine stopped
// answering, since an SSH transport's `stopApi` closes this same client. Every engine command travels on it, so the
// user's next action used to fail with "SSH connection is not established" until something else happened to reconnect.
const closedTransport = (opened: string[], calls: string[][]) => {
  const transport = new SSHTransport();
  let connection: any = { isConnected: () => false };
  (transport as any)._connection = connection;
  (transport as any).startSSHConnection = async (host: any) => {
    opened.push(host?.Name);
    connection = fakeConnection(calls);
    (transport as any)._connection = connection;
    return "running";
  };
  return transport;
};

describe("SSHTransport.runScopeCommand — a closed connection is reopened, not refused", () => {
  it("reconnects the scope and runs the command", async () => {
    const opened: string[] = [];
    const calls: string[][] = [];
    const transport = closedTransport(opened, calls);

    const result = await transport.runScopeCommand({} as any, "podman", ["ps"], "win11");

    expect(opened).toEqual(["win11"]);
    expect(calls[0]).toEqual(["podman", "ps"]);
    expect(result.success).toBe(true);
  });

  // Two commands racing the same dead client must not open two connections — the second would replace the first
  // under whatever was already using it.
  it("shares one reconnect between commands that asked at the same time", async () => {
    const opened: string[] = [];
    const calls: string[][] = [];
    const transport = closedTransport(opened, calls);

    await Promise.all([
      transport.runScopeCommand({} as any, "podman", ["ps"], "win11"),
      transport.runScopeCommand({} as any, "podman", ["images"], "win11"),
    ]);

    expect(opened).toEqual(["win11"]);
    expect(calls).toHaveLength(2);
  });

  // Nothing to reconnect TO is still an error, and it says which scope could not be reached rather than only that
  // something was not established.
  it("says which scope could not be reconnected", async () => {
    const transport = new SSHTransport();
    (transport as any)._connection = { isConnected: () => false };
    (transport as any).startSSHConnection = async () => "error";

    await expect(transport.runScopeCommand({} as any, "podman", ["ps"], "win11")).rejects.toThrow(/win11/);
  });

  it("still refuses when there is no scope to reconnect", async () => {
    const transport = new SSHTransport();
    (transport as any)._connection = { isConnected: () => false };

    await expect(transport.runScopeCommand({} as any, "podman", ["ps"])).rejects.toThrow(
      /SSH connection is not established/,
    );
  });
});

describe("SSHTransport.runScopeCommand — cmd.exe argv quoting", () => {
  it("quotes a spaced Windows engine path so cmd.exe runs the whole path, not `C:\\Program`", async () => {
    const calls: string[][] = [];
    await transportWith(calls).runScopeCommand(
      {} as any,
      "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
      ["context", "inspect", "--format", "json"],
    );
    expect(calls[0][0]).toBe('"C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"');
    expect(calls[0].slice(1)).toEqual(["context", "inspect", "--format", "json"]);
  });

  it("leaves POSIX program names untouched (no regression for Linux/macOS SSH remotes)", async () => {
    const calls: string[][] = [];
    await transportWith(calls).runScopeCommand({} as any, "podman", ["info"]);
    expect(calls[0]).toEqual(["podman", "info"]);
  });

  it("does not double-quote an already-quoted path", async () => {
    const calls: string[][] = [];
    await transportWith(calls).runScopeCommand({} as any, '"C:\\Program Files\\X\\x.exe"', ["--version"]);
    expect(calls[0][0]).toBe('"C:\\Program Files\\X\\x.exe"');
  });

  it("also quotes for the streaming variant (builds run the same argv)", async () => {
    const calls: string[][] = [];
    await transportWith(calls).runScopeCommandStreaming({} as any, "C:\\Program Files\\RedHat\\Podman\\podman.exe", [
      "build",
      ".",
    ]);
    expect(calls[0][0]).toBe('"C:\\Program Files\\RedHat\\Podman\\podman.exe"');
  });
});
