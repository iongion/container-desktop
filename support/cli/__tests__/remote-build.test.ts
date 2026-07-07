import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectSourceEntries,
  executeBundle,
  loadLocalBuildBoxes,
  posixBuildScript,
  REMOTE_BUILD_ROOT,
  type RemoteBundlePlan,
  resolveRemoteBundle,
  windowsBuildScript,
  windowsPrepareScript,
} from "@/cli/lib/remote-build";

const tempDirs: string[] = [];

function makeTmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-remote-test-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("loadLocalBuildBoxes", () => {
  it("loads from dotenv files with the local override winning", () => {
    const root = makeTmp({
      ".env": ["BUILD_WIN_BOX=base-win", "BUILD_MAC_BOX=base-mac", "UNRELATED_SECRET=do-not-return"].join("\n"),
      ".env.development.local": ['BUILD_WIN_BOX="dev-win"', "BUILD_MAC_BOX='dev mac'", "BUILD_LIN_BOX=dev-linux"].join(
        "\n",
      ),
    });

    const boxes = loadLocalBuildBoxes(root, {}, "development");

    expect(boxes).toEqual({ win: "dev-win", mac: "dev mac", linux: "dev-linux" });
  });

  it("follows the vite environment source order", () => {
    const root = makeTmp({
      ".env": ["BUILD_WIN_BOX=base-win", "BUILD_MAC_BOX=base-mac", "BUILD_LIN_BOX=base-linux"].join("\n"),
      ".env.local": "BUILD_WIN_BOX=local-win\n",
      ".env.development.local": "BUILD_WIN_BOX=dev-win\n",
      ".env.production": "BUILD_WIN_BOX=prod-win\n",
      ".env.production.local": "BUILD_MAC_BOX=prod-local-mac\n",
    });

    const boxes = loadLocalBuildBoxes(root, {}, "production");

    expect(boxes).toEqual({ win: "prod-win", mac: "prod-local-mac", linux: "base-linux" });
  });
});

describe("resolveRemoteBundle", () => {
  beforeEach(() => {
    // Isolate from the runner's ambient CI markers so the cross-OS path is exercised deterministically.
    vi.stubEnv("CI", "");
    vi.stubEnv("GITHUB_ACTIONS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the matching box for a cross-OS local build", () => {
    const root = makeTmp({ ".env.development.local": "BUILD_WIN_BOX=builder-win\n" });

    const plan = resolveRemoteBundle("package:tauri:win_x64", {}, "Linux", root, "development");

    expect(plan).toEqual({
      platform: "win",
      box: "builder-win",
      script: "package:tauri:win_x64",
      root: REMOTE_BUILD_ROOT,
    });
  });

  it("uses a configured box path", () => {
    const root = makeTmp({
      ".env.development.local": ["BUILD_WIN_BOX=builder-win", "BUILD_WIN_BOX_PATH=D:/builds/container-desktop"].join(
        "\n",
      ),
    });

    const plan = resolveRemoteBundle("package:tauri:win_x64", {}, "Linux", root, "development");

    expect(plan?.root).toBe("D:/builds/container-desktop");
  });

  it("falls back to the default root for an empty configured path", () => {
    const root = makeTmp({
      ".env.development.local": ["BUILD_WIN_BOX=builder-win", "BUILD_WIN_BOX_PATH="].join("\n"),
    });

    const plan = resolveRemoteBundle("package:tauri:win_x64", {}, "Linux", root, "development");

    expect(plan?.root).toBe(REMOTE_BUILD_ROOT);
  });

  it("is disabled in CI", () => {
    const root = makeTmp({ ".env.development.local": "BUILD_WIN_BOX=builder-win\n" });

    const plan = resolveRemoteBundle("package:tauri:win_x64", { CI: "true" }, "Linux", root, "development");

    expect(plan).toBeNull();
  });

  it("keeps native-host builds local", () => {
    const root = makeTmp({ ".env.development.local": "BUILD_WIN_BOX=builder-win\n" });

    const plan = resolveRemoteBundle("package:tauri:win_x64", {}, "Windows", root, "development");

    expect(plan).toBeNull();
  });
});

describe("remote scripts", () => {
  it("does not fail after the optional Windows cleanup", () => {
    const prepare = windowsPrepareScript();
    const build = windowsBuildScript("package:tauri:win_x64");

    expect(prepare).toContain("$ProgressPreference = 'SilentlyContinue'");
    expect(build).toContain("$ProgressPreference = 'SilentlyContinue'");
    expect(prepare.trimEnd().endsWith("exit 0")).toBe(true);
  });

  it("falls back to corepack yarn", () => {
    const windowsScript = windowsBuildScript("package:tauri:win_x64");
    const posixScript = posixBuildScript("package:tauri:linux_x86");

    expect(windowsScript).toContain("function Invoke-Yarn");
    expect(windowsScript).toContain("corepack yarn @Arguments");
    expect(windowsScript).toContain("if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }");
    expect(posixScript).toContain("remote_yarn() {");
    expect(posixScript).toContain('corepack yarn "$@"');
  });
});

describe("collectSourceEntries — remote source archive contents", () => {
  it("keeps sources but excludes generated build output (src-wails bin/ + frontend/dist, src-tauri/target)", () => {
    const root = makeTmp({});
    const write = (rel: string) => {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "x");
    };
    write("package.json");
    write("src-wails/main.go");
    write("src-wails/go.mod");
    write("src-wails/bin/container-desktop-linux-amd64");
    write("src-wails/frontend/dist/index.html");
    write("src-tauri/src/lib.rs");
    write("src-tauri/target/release/app");
    write("node_modules/pkg/index.js");

    const entries = collectSourceEntries(root);

    // real sources are archived (sent to the remote build box)
    expect(entries).toEqual(
      expect.arrayContaining(["package.json", "src-wails/main.go", "src-wails/go.mod", "src-tauri/src/lib.rs"]),
    );
    // regenerated-on-the-box build output is excluded to keep the archive lean
    expect(entries).not.toContain("src-wails/bin/container-desktop-linux-amd64");
    expect(entries).not.toContain("src-wails/frontend/dist/index.html");
    expect(entries).not.toContain("src-tauri/target/release/app");
    expect(entries).not.toContain("node_modules/pkg/index.js");
  });
});

describe("executeBundle", () => {
  it("dispatches to the remote builder when a plan resolves", async () => {
    const plan: RemoteBundlePlan = {
      platform: "win",
      box: "builder-win",
      script: "package:tauri:win_x64",
      root: REMOTE_BUILD_ROOT,
    };
    const remoteCalls: RemoteBundlePlan[] = [];

    const result = await executeBundle(
      { PACKAGE_SCRIPT: "package:tauri:win_x64" },
      {
        resolveRemote: () => plan,
        runRemote: (received) => {
          remoteCalls.push(received);
        },
        runLocal: () => {
          throw new Error("bundle should use the remote builder");
        },
      },
    );

    expect(remoteCalls).toEqual([plan]);
    expect(result).toEqual({ script: "package:tauri:win_x64", remote: true });
  });

  it("builds locally when no remote plan resolves", async () => {
    const localCalls: Array<[string, unknown]> = [];

    const result = await executeBundle(
      { PACKAGE_SCRIPT: "package:tauri:linux_x86" },
      {
        resolveRemote: () => null,
        runRemote: () => {
          throw new Error("bundle should build locally");
        },
        runLocal: (script, env) => {
          localCalls.push([script, env]);
        },
      },
    );

    expect(localCalls).toEqual([["package:tauri:linux_x86", { PACKAGE_SCRIPT: "package:tauri:linux_x86" }]]);
    expect(result).toEqual({ script: "package:tauri:linux_x86", remote: false });
  });
});
