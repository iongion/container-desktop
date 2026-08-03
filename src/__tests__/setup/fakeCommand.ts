import EventEmitter from "eventemitter3";
import type { CommandExecutionResult } from "@/host-contract/exec";

export interface RecordedCall {
  launcher: string;
  args: string[];
  opts?: any;
}

export interface FakeCommandHandle {
  // Every Execute / Spawn / ExecuteAsBackgroundService invocation, in order.
  calls: RecordedCall[];
  // Restore the previous global `Command`. Call in afterEach.
  restore: () => void;
}

const okResult = (over?: Partial<CommandExecutionResult>): CommandExecutionResult => ({
  pid: 1,
  code: 0,
  success: true,
  stdout: "",
  stderr: "",
  ...over,
});

// Replace the global `Command` with a recording fake. The handler can shape the result per call
// (e.g. return `{ success: false, stderr }` to simulate a failure). ALL `ICommand` members are
// implemented — `startTunnel`/availability paths call `CreateNodeJSApiDriver` +
// `ExecuteAsBackgroundService`, so a fake that only handles `Execute` would crash those tests.
export function installFakeCommand(
  handler?: (call: RecordedCall) => Partial<CommandExecutionResult>,
): FakeCommandHandle {
  const calls: RecordedCall[] = [];
  const previous = (globalThis as unknown as Record<string, unknown>).Command;
  const record = (launcher: string, args: string[], opts?: any) => {
    const call: RecordedCall = { launcher, args, opts };
    calls.push(call);
    return okResult(handler?.(call));
  };
  const fake = {
    async Execute(launcher: string, args: string[], opts?: any) {
      return record(launcher, args, opts);
    },
    async Spawn(launcher: string, args: string[], opts?: any) {
      return record(launcher, args, opts);
    },
    async Kill() {
      // no-op
    },
    async CreateNodeJSApiDriver() {
      return { request: async () => ({ status: 200, data: "OK" }) };
    },
    async ExecuteStreaming(launcher: string, args: string[], opts?: any) {
      record(launcher, args, opts);
      const emitter = new EventEmitter();
      // Emit on a macrotask so the caller's `handle.on("exit", …)` registers first (see the
      // ExecuteAsBackgroundService note below). One stdout chunk then a clean exit.
      setTimeout(() => {
        emitter.emit("data", { from: "stdout", data: "" });
        emitter.emit("exit", { code: 0 });
        emitter.emit("close", { code: 0 });
      }, 0);
      return {
        on: (event: string, listener: any) => emitter.on(event as any, listener),
        off: (event: string, listener: any) => emitter.off(event as any, listener),
        dispose: () => emitter.removeAllListeners(),
        kill: () => {},
      };
    },
    async ExecuteAsBackgroundService(launcher: string, args: string[], opts?: any) {
      record(launcher, args, opts);
      const emitter = new EventEmitter();
      // Background services resolve when the underlying process signals "ready". Emit on a macrotask
      // (not a microtask) so the caller's `.then(client => client.on("ready", …))` registers the
      // listener first — otherwise the event fires before anyone is listening and the await hangs.
      setTimeout(
        () =>
          emitter.emit("ready", {
            process: okResult(),
            child: { pid: 1, code: 0, success: true, kill: () => {}, unref: () => {} },
          }),
        0,
      );
      return emitter;
    },
    async StartSSHConnection() {
      throw new Error("installFakeCommand: StartSSHConnection is not faked — provide a custom fake if a test needs it");
    },
    async StopConnectionServices() {
      // no-op
    },
    async ProxyRequest() {
      return { status: 200, data: "OK" };
    },
  };
  (globalThis as unknown as Record<string, unknown>).Command = fake;
  return {
    calls,
    restore: () => {
      (globalThis as unknown as Record<string, unknown>).Command = previous;
    },
  };
}
