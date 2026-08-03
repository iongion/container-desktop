import { describe, expect, it } from "vitest";

import { createVirtualEngineHost } from "@/ai-system/testing/virtualEngineHost";

const CONN = "conn-1";

async function makeSandbox() {
  const host = createVirtualEngineHost();
  const { containerId } = await host.createSandboxContainer(CONN, "alpine:3", {
    runId: "r1",
    label: "container-desktop.ai.sandbox=r1",
  });
  return { host, containerId };
}

describe("createVirtualEngineHost", () => {
  it("createSandboxContainer starts a labeled container with /workspace present", async () => {
    const { host, containerId } = await makeSandbox();
    expect(containerId).toMatch(/^[a-f0-9]{12}$/);
    const stat = await host.execInContainer(CONN, containerId, "stat", ["-c", "%s %Y %F", "/workspace"]);
    expect(stat.code).toBe(0);
    expect(stat.stdout).toContain("directory");
    expect(host.liveSandboxes()).toHaveLength(1);
  });

  it("tee (stdin) → cat roundtrips content, honoring piped input", async () => {
    const { host, containerId } = await makeSandbox();
    const wrote = await host.execInContainer(CONN, containerId, "tee", ["/workspace/a.txt"], { input: "hello\n" });
    expect(wrote.code).toBe(0);
    const read = await host.execInContainer(CONN, containerId, "cat", ["/workspace/a.txt"]);
    expect(read.stdout).toBe("hello\n");
  });

  it("cat a missing file exits 1", async () => {
    const { host, containerId } = await makeSandbox();
    const read = await host.execInContainer(CONN, containerId, "cat", ["/workspace/missing"]);
    expect(read.code).toBe(1);
  });

  it("mkdir -p then ls -1Ap lists files and dirs with a trailing slash", async () => {
    const { host, containerId } = await makeSandbox();
    await host.execInContainer(CONN, containerId, "mkdir", ["-p", "/workspace/sub"]);
    await host.execInContainer(CONN, containerId, "tee", ["/workspace/top.txt"], { input: "x" });
    const ls = await host.execInContainer(CONN, containerId, "ls", ["-1Ap", "/workspace"]);
    const names = ls.stdout.split("\n").filter(Boolean).sort();
    expect(names).toEqual(["sub/", "top.txt"]);
  });

  it("find -type f and grep -rnIE work over the tree", async () => {
    const { host, containerId } = await makeSandbox();
    await host.execInContainer(CONN, containerId, "tee", ["/workspace/one.txt"], { input: "alpha\nNEEDLE here\n" });
    await host.execInContainer(CONN, containerId, "tee", ["/workspace/two.txt"], { input: "beta\n" });
    const find = await host.execInContainer(CONN, containerId, "find", ["/workspace", "-type", "f"]);
    expect(find.stdout.split("\n").filter(Boolean).sort()).toEqual(["/workspace/one.txt", "/workspace/two.txt"]);
    const hit = await host.execInContainer(CONN, containerId, "grep", ["-rnIE", "--", "NEEDLE", "/workspace"]);
    expect(hit.code).toBe(0);
    expect(hit.stdout).toBe("/workspace/one.txt:2:NEEDLE here\n");
    const miss = await host.execInContainer(CONN, containerId, "grep", ["-rnIE", "--", "ZZZ", "/workspace"]);
    expect(miss.code).toBe(1);
  });

  it("rm -r removes a subtree", async () => {
    const { host, containerId } = await makeSandbox();
    await host.execInContainer(CONN, containerId, "tee", ["/workspace/sub/f.txt"], { input: "x" });
    await host.execInContainer(CONN, containerId, "rm", ["-r", "/workspace/sub"]);
    const read = await host.execInContainer(CONN, containerId, "cat", ["/workspace/sub/f.txt"]);
    expect(read.code).toBe(1);
  });

  it("removeSandboxContainer makes further exec fail and clears it from live sandboxes", async () => {
    const { host, containerId } = await makeSandbox();
    await host.removeSandboxContainer(CONN, containerId);
    expect(host.liveSandboxes()).toHaveLength(0);
    await expect(host.execInContainer(CONN, containerId, "cat", ["/workspace/x"])).rejects.toThrow(/no container/);
  });

  it("execOnConnection uses a per-connection root filesystem, isolated across connections", async () => {
    const host = createVirtualEngineHost();
    await host.execOnConnection("a", "mkdir", ["-p", "/tmp/ws"]);
    await host.execOnConnection("a", "tee", ["/tmp/ws/f.txt"], { input: "from-a" });
    const readA = await host.execOnConnection("a", "cat", ["/tmp/ws/f.txt"]);
    expect(readA.stdout).toBe("from-a");
    const readB = await host.execOnConnection("b", "cat", ["/tmp/ws/f.txt"]);
    expect(readB.code).toBe(1);
  });

  it("echo runs as a generic command", async () => {
    const { host, containerId } = await makeSandbox();
    const res = await host.execInContainer(CONN, containerId, "echo", ["hi", "there"]);
    expect(res.stdout).toBe("hi there\n");
  });

  it("an unknown program fails with 127 (command not found), not a masked success", async () => {
    const { host, containerId } = await makeSandbox();
    const res = await host.execInContainer(CONN, containerId, "definitely-not-a-real-program", ["--help"]);
    expect(res.code).toBe(127);
    expect(res.stderr).toContain("unknown command definitely-not-a-real-program");
    expect(res.stdout).toBe("");
  });

  it("an unknown program on a connection host also fails with 127", async () => {
    const host = createVirtualEngineHost();
    const res = await host.execOnConnection("a", "nope", []);
    expect(res.code).toBe(127);
  });
});
