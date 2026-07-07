import { describe, expect, it } from "vitest";

import {
  buildComposeDownArgs,
  buildComposeUpArgs,
  buildComposeVersionArgs,
  parseComposeUpSummary,
} from "./compose-cli";

describe("compose-cli arg builders", () => {
  it("builds `compose -f <file> -p <project> up -d` (global flags before the subcommand)", () => {
    expect(buildComposeUpArgs({ file: "/work/proj/docker-compose.yml", project: "proj" })).toEqual([
      "compose",
      "-f",
      "/work/proj/docker-compose.yml",
      "-p",
      "proj",
      "up",
      "-d",
    ]);
  });

  it("appends --remove-orphans after the up subcommand when requested", () => {
    expect(buildComposeUpArgs({ file: "c.yml", project: "p", removeOrphans: true })).toEqual([
      "compose",
      "-f",
      "c.yml",
      "-p",
      "p",
      "up",
      "-d",
      "--remove-orphans",
    ]);
  });

  it("omits -p when no project name is given", () => {
    expect(buildComposeUpArgs({ file: "c.yml" })).toEqual(["compose", "-f", "c.yml", "up", "-d"]);
  });

  it("builds `compose -p <project> down`, adding -v only when removing volumes", () => {
    expect(buildComposeDownArgs({ project: "proj" })).toEqual(["compose", "-p", "proj", "down"]);
    expect(buildComposeDownArgs({ project: "proj", removeVolumes: true })).toEqual([
      "compose",
      "-p",
      "proj",
      "down",
      "-v",
    ]);
  });

  it("builds the version probe", () => {
    expect(buildComposeVersionArgs()).toEqual(["compose", "version"]);
  });
});

describe("parseComposeUpSummary", () => {
  it("maps compose v2 progress tokens to the change summary (ignoring networks/volumes)", () => {
    // Real `docker compose up -d` captured output: spinner glyphs, a [+] header, and Network/Volume lines
    // that must NOT be counted as containers.
    const output = [
      "[+] Running 4/4",
      " ✔ Network proj_default    Created",
      " ✔ Volume proj_data        Created",
      " ✔ Container proj-db-1     Created",
      " ✔ Container proj-db-1     Started",
      " ✔ Container proj-web-1    Created",
      " ✔ Container proj-web-1    Started",
    ].join("\n");
    const summary = parseComposeUpSummary(output);
    // A fresh container appears in BOTH created and started (create phase + start phase), mirroring the
    // libpod orchestrator's two-pass summary.
    expect(summary.created.sort()).toEqual(["proj-db-1", "proj-web-1"]);
    expect(summary.started.sort()).toEqual(["proj-db-1", "proj-web-1"]);
    expect(summary.recreated).toEqual([]);
    expect(summary.unchanged).toEqual([]);
    expect(summary.orphansRemoved).toEqual([]);
  });

  it("classifies Running as unchanged and Recreated as recreated", () => {
    const output = [" ✔ Container proj-db-1  Running", " ✔ Container proj-web-1  Recreated"].join("\n");
    const summary = parseComposeUpSummary(output);
    expect(summary.unchanged).toEqual(["proj-db-1"]);
    expect(summary.recreated).toEqual(["proj-web-1"]);
    expect(summary.started).toEqual([]);
    expect(summary.created).toEqual([]);
  });

  it("classifies Removed (from --remove-orphans) as orphansRemoved", () => {
    const summary = parseComposeUpSummary(" ✔ Container proj-orphan-1  Removed");
    expect(summary.orphansRemoved).toEqual(["proj-orphan-1"]);
  });

  it("strips ANSI color codes and de-dupes repeated transitions", () => {
    const output = [
      " [32m✔[0m Container proj-web-1  [32mCreated[0m",
      " Container proj-web-1  Created", // duplicate transition line (non-TTY re-render)
      " Container proj-web-1  Started",
    ].join("\n");
    const summary = parseComposeUpSummary(output);
    expect(summary.created).toEqual(["proj-web-1"]);
    expect(summary.started).toEqual(["proj-web-1"]);
  });

  it("returns an empty summary for output with no recognizable container lines", () => {
    expect(parseComposeUpSummary("some unrelated text\n[+] Running 0/0")).toEqual({
      created: [],
      recreated: [],
      unchanged: [],
      started: [],
      orphansRemoved: [],
    });
  });
});
