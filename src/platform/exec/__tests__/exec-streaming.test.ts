import { describe, expect, it } from "vitest";
import { Command } from "@/platform/node-executor";

describe("ExecuteStreaming", () => {
  it("streams stdout then exits 0 with no retry/max-retries error", async () => {
    const handle = await Command.ExecuteStreaming("node", ["-e", "process.stdout.write('hello')"]);
    const out: string[] = [];
    const errors: any[] = [];
    const code = await new Promise<number | null>((resolve) => {
      handle.on("data", ({ from, data }) => from === "stdout" && out.push(data));
      handle.on("error", (e) => errors.push(e));
      handle.on("exit", ({ code }) => resolve(code));
    });
    expect(out.join("")).toContain("hello");
    expect(code).toBe(0);
    expect(errors).toEqual([]); // exec_service would emit domain.max-retries here
  });

  it("off() detaches a listener", async () => {
    const handle = await Command.ExecuteStreaming("node", ["-e", "setTimeout(()=>{},50)"]);
    const seen: any[] = [];
    const cb = (p: any) => seen.push(p);
    handle.on("data", cb);
    handle.off("data", cb);
    handle.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 100));
    expect(seen).toEqual([]);
  });
});
