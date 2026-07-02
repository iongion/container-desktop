import { describe, expect, it } from "vitest";
import { SSHTransport } from "./ssh";

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
