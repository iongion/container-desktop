import { describe, expect, it } from "vitest";

import { Presence } from "@/container-client/types/engine";

import { detectScopes, parseLimaList, parsePodmanMachineList, parseWslList } from "./scopeDetection";
import type { DetectedProgram } from "./types";

const programs = (names: string[]): DetectedProgram[] => names.map((name) => ({ name, present: Presence.AVAILABLE }));

describe("parsePodmanMachineList", () => {
  it("parses `podman machine list --format json`, usable = running", () => {
    const out = parsePodmanMachineList(
      '[{"Name":"podman-machine-default","Running":true},{"Name":"cd","Running":false}]',
    );
    expect(out).toEqual([
      { kind: "podman.machine", name: "podman-machine-default", usable: true },
      { kind: "podman.machine", name: "cd", usable: false },
    ]);
  });

  it("returns [] for junk", () => {
    expect(parsePodmanMachineList("not json")).toEqual([]);
  });
});

describe("parseLimaList", () => {
  it("parses limactl JSON-lines, usable = Running", () => {
    const out = parseLimaList('{"name":"default","status":"Running"}\n{"name":"cd","status":"Stopped"}\n');
    expect(out).toEqual([
      { kind: "lima.instance", name: "default", usable: true },
      { kind: "lima.instance", name: "cd", usable: false },
    ]);
  });
});

describe("parseWslList", () => {
  it("parses distro names, stripping NUL padding + the header line", () => {
    const out = parseWslList("Windows Subsystem for Linux Distributions:\nUbuntu-24.04\x00\ncontainer-desktop\n");
    expect(out).toEqual([
      { kind: "wsl.distro", name: "Ubuntu-24.04", usable: true },
      { kind: "wsl.distro", name: "container-desktop", usable: true },
    ]);
  });
});

describe("detectScopes", () => {
  it("only enumerates controllers whose program is present, merging the results", async () => {
    const calls: string[] = [];
    const run = async (program: string, _args: string[]) => {
      calls.push(program);
      if (program === "podman") return '[{"Name":"m1","Running":true}]';
      if (program === "limactl") return '{"name":"l1","status":"Running"}';
      return "";
    };
    const scopes = await detectScopes(programs(["podman", "limactl"]), run);
    expect(calls.sort()).toEqual(["limactl", "podman"]);
    expect(scopes).toContainEqual({ kind: "podman.machine", name: "m1", usable: true });
    expect(scopes).toContainEqual({ kind: "lima.instance", name: "l1", usable: true });
  });

  it("skips a controller that isn't installed", async () => {
    const run = async () => "";
    expect(await detectScopes(programs(["docker"]), run)).toEqual([]);
  });

  it("never throws when a list command fails", async () => {
    const run = async () => {
      throw new Error("command failed");
    };
    expect(await detectScopes(programs(["podman"]), run)).toEqual([]);
  });
});
