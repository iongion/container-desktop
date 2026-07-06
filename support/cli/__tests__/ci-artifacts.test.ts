import { describe, expect, it } from "vitest";
import {
  type GhArtifact,
  parseAppxVersion,
  parseWindowsStorePackageVersion,
  pickStorePackage,
  resolveStoreArches,
  selectWindowsArtifact,
  windowsArtifactName,
} from "@/cli/lib/ci-artifacts";

function artifact(
  id: number,
  {
    name = "container-desktop-windows-x64",
    expired = false,
    runId,
  }: { name?: string; expired?: boolean; runId?: number } = {},
): GhArtifact {
  return { id, name, expired, workflow_run: { id: runId ?? id * 10 } };
}

describe("selectWindowsArtifact", () => {
  it("resolves explicit Windows artifact names", () => {
    expect(windowsArtifactName("x64")).toBe("container-desktop-windows-x64");
    expect(windowsArtifactName("arm64")).toBe("container-desktop-windows-arm");
  });

  it("picks the newest non-expired Windows artifact regardless of order", () => {
    const artifacts = [artifact(1, { runId: 100 }), artifact(3, { runId: 300 }), artifact(2, { runId: 200 })];
    expect(selectWindowsArtifact(artifacts)?.workflow_run?.id).toBe(300);
  });

  it("picks the requested Windows ARM artifact", () => {
    const artifacts = [
      artifact(1, { name: "container-desktop-windows-x64", runId: 100 }),
      artifact(2, { name: "container-desktop-windows-arm", runId: 200 }),
    ];
    expect(selectWindowsArtifact(artifacts, undefined, "arm64")?.workflow_run?.id).toBe(200);
  });

  it("skips expired artifacts", () => {
    const artifacts = [artifact(5, { expired: true, runId: 500 }), artifact(2, { runId: 200 })];
    expect(selectWindowsArtifact(artifacts)?.workflow_run?.id).toBe(200);
  });

  it("ignores other-platform artifacts", () => {
    const artifacts = [artifact(9, { name: "container-desktop-linux", runId: 900 }), artifact(4, { runId: 400 })];
    expect(selectWindowsArtifact(artifacts)?.workflow_run?.id).toBe(400);
  });

  it("returns null when there are no artifacts", () => {
    expect(selectWindowsArtifact([])).toBeNull();
  });

  it("returns null when all artifacts are expired", () => {
    expect(selectWindowsArtifact([artifact(1, { expired: true }), artifact(2, { expired: true })])).toBeNull();
  });
});

describe("parseAppxVersion", () => {
  it("parses an x64 filename", () => {
    expect(parseAppxVersion("container-desktop-x64-5.3.11.appx")).toBe("5.3.11");
  });

  it("parses from a full path", () => {
    expect(parseAppxVersion("/tmp/dl/container-desktop-x64-5.3.13.appx")).toBe("5.3.13");
  });

  it("parses an arm64 filename", () => {
    expect(parseAppxVersion("container-desktop-arm64-5.3.13.appx")).toBe("5.3.13");
  });

  it("parses a prerelease version", () => {
    expect(parseAppxVersion("container-desktop-x64-5.3.13-beta.1.appx")).toBe("5.3.13-beta.1");
  });

  it("returns null for a non-appx name", () => {
    expect(parseAppxVersion("container-desktop-x64-5.3.11.exe")).toBeNull();
  });
});

describe("resolveStoreArches", () => {
  it("fetches both arches when none is requested", () => {
    expect(resolveStoreArches()).toEqual(["x64", "arm64"]);
    expect(resolveStoreArches(undefined)).toEqual(["x64", "arm64"]);
  });

  it("narrows to a single requested arch", () => {
    expect(resolveStoreArches("x64")).toEqual(["x64"]);
    expect(resolveStoreArches("arm64")).toEqual(["arm64"]);
  });
});

describe("pickStorePackage", () => {
  const files = [
    "/dl/container-desktop-x64-5.3.18.exe",
    "/dl/container-desktop-x64-5.3.18.zip",
    "/dl/container-desktop-x64-5.3.18.msix",
    "/dl/container-desktop-x64-5.3.18.appx",
  ];

  it("picks the appx for the appx format", () => {
    expect(pickStorePackage(files, "appx")).toBe("/dl/container-desktop-x64-5.3.18.appx");
  });

  it("picks the msix for the msix format", () => {
    expect(pickStorePackage(files, "msix")).toBe("/dl/container-desktop-x64-5.3.18.msix");
  });

  it("returns null when the format is absent", () => {
    expect(pickStorePackage(["/dl/container-desktop-x64-5.3.18.zip"], "appx")).toBeNull();
  });
});

describe("parseWindowsStorePackageVersion", () => {
  it("parses an appx package", () => {
    expect(parseWindowsStorePackageVersion("container-desktop-x64-5.3.11.appx")).toBe("5.3.11");
  });

  it("parses an msix package", () => {
    expect(parseWindowsStorePackageVersion("container-desktop-x64-5.3.11.msix")).toBe("5.3.11");
  });

  it("returns null for a non-store-package name", () => {
    expect(parseWindowsStorePackageVersion("container-desktop-x64-5.3.11.exe")).toBeNull();
  });
});
