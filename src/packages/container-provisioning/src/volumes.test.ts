import { describe, expect, it } from "vitest";

import { ContainerEngine } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";

import { addFolderChoice, folderDisplayName, resolveVolumeSpecs, usernsFlag, volumePreview } from "./volumes";

describe("folderDisplayName", () => {
  it("shows just the final path segment (the full path lives in the -v preview)", () => {
    expect(folderDisplayName("/home/istoica/Downloads")).toBe("Downloads");
    expect(folderDisplayName("/home/istoica/Downloads/")).toBe("Downloads");
    expect(folderDisplayName("C:\\Users\\me\\Projects")).toBe("Projects");
  });

  it("keeps home and root markers legible", () => {
    expect(folderDisplayName("~")).toBe("~");
    expect(folderDisplayName("/")).toBe("/");
  });
});

describe("addFolderChoice", () => {
  it("appends a newly picked folder as read-write", () => {
    const next = addFolderChoice([{ hostPath: "~", mode: "rw" }], "/home/me/app");
    expect(next).toEqual([
      { hostPath: "~", mode: "rw" },
      { hostPath: "/home/me/app", mode: "rw" },
    ]);
  });

  it("ignores a folder that is already chosen (returns the same array reference)", () => {
    const current = [{ hostPath: "~", mode: "rw" as const }];
    expect(addFolderChoice(current, "~")).toBe(current);
  });
});

describe("resolveVolumeSpecs", () => {
  it("applies the decision-table id strategy to each folder (Linux Podman → keep-id+U)", () => {
    const specs = resolveVolumeSpecs(OperatingSystem.Linux, ContainerEngine.PODMAN, [
      { hostPath: "/home/me/app", mode: "rw" },
    ]);
    expect(specs[0]).toMatchObject({
      hostPath: "/home/me/app",
      guestPath: "/home/me/app",
      mode: "rw",
      idStrategy: "keep-id+U",
    });
  });

  it("uses run-as-user for Linux Docker", () => {
    const specs = resolveVolumeSpecs(OperatingSystem.Linux, ContainerEngine.DOCKER, [{ hostPath: "/x", mode: "ro" }]);
    expect(specs[0].idStrategy).toBe("run-as-user");
  });
});

describe("volumePreview", () => {
  it("appends U for keep-id+U and ro for read-only, comma-joining options", () => {
    expect(volumePreview({ hostPath: "/a", guestPath: "/a", mode: "rw", idStrategy: "keep-id+U" })).toBe("-v /a:/a:U");
    expect(volumePreview({ hostPath: "/a", guestPath: "/a", mode: "ro", idStrategy: "keep-id+U" })).toBe(
      "-v /a:/a:ro,U",
    );
    expect(volumePreview({ hostPath: "/a", guestPath: "/a", mode: "rw", idStrategy: "none" })).toBe("-v /a:/a");
  });
});

describe("usernsFlag", () => {
  it("maps the id strategy to its run-level flag", () => {
    expect(usernsFlag("keep-id")).toBe("--userns=keep-id");
    expect(usernsFlag("keep-id+U")).toBe("--userns=keep-id");
    expect(usernsFlag("run-as-user")).toBe("-u $(id -u):$(id -g)");
    expect(usernsFlag("none")).toBeUndefined();
  });
});
