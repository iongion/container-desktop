import { describe, expect, it, vi } from "vitest";
import { createPath, createPlatform } from "./host";

describe("createPath", () => {
  it("normalizes separators for Windows paths", async () => {
    const path = createPath("Windows_NT");

    await expect(path.join("C:\\Users", "istoica/project", "file.txt")).resolves.toBe(
      "C:\\Users\\istoica\\project\\file.txt",
    );
    await expect(path.basename("C:\\Users\\istoica\\project\\file.txt", ".txt")).resolves.toBe("file");
    await expect(path.dirname("C:\\Users\\istoica\\project\\file.txt")).resolves.toBe("C:\\Users\\istoica\\project");
  });

  it("collapses . and .. segments like node's path (posix)", async () => {
    const path = createPath("Linux");

    await expect(path.join("a", "b", "..", "c")).resolves.toBe("a/c");
    await expect(path.join("a", "./b", "c")).resolves.toBe("a/b/c");
    await expect(path.resolve("a/b", "../c")).resolves.toBe("a/c");
    await expect(path.join("/var", "..", "etc")).resolves.toBe("/etc");
    // A relative path may still ascend above its start; an absolute path cannot go above root.
    await expect(path.join("a", "..", "..", "b")).resolves.toBe("../b");
    await expect(path.join("/a", "..", "..")).resolves.toBe("/");
  });

  it("collapses . and .. segments for Windows paths", async () => {
    const path = createPath("Windows_NT");

    await expect(path.join("C:\\a", "b", "..", "c")).resolves.toBe("C:\\a\\c");
    await expect(path.join("C:\\a\\b", ".\\c")).resolves.toBe("C:\\a\\b\\c");
  });
});

describe("createPlatform", () => {
  it("normalizes launchTerminal overloads into the Rust launch_terminal payload", async () => {
    const invoke = vi.fn(async () => undefined);
    const platform = createPlatform(invoke, "Linux");

    await platform.launchTerminal({ commandLauncher: "podman", params: ["ps"], title: "Containers" });

    expect(invoke).toHaveBeenCalledWith("launch_terminal", {
      payload: { launcher: "podman", args: ["ps"], title: "Containers" },
    });
  });
});
