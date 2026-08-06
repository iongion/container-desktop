import { describe, expect, it } from "vitest";

import { parseEnvFile } from "@/pi-agent-host/envFile";

// The environment the app composes reaches this container as a FILE for every engine that can be handed one from the
// app's own machine, and as this file's content for every engine that cannot — a remote one, whose `--env-file` is
// read on ITS machine, where a path from ours does not exist. One composer, one format, two ways in.

describe("parseEnvFile", () => {
  it("reads what the app's own composer writes", () => {
    const parsed = parseEnvFile(
      ["CD_BRIDGE_TOKEN=8f14e45f", "CD_BRIDGE_PORT=8787", "CD_MODEL_ID=qwen3.5-9b-mtp", ""].join("\n"),
    );

    expect(parsed).toEqual({
      CD_BRIDGE_TOKEN: "8f14e45f",
      CD_BRIDGE_PORT: "8787",
      CD_MODEL_ID: "qwen3.5-9b-mtp",
    });
  });

  // A value may hold the separator — a base URL carries one in `https://`, and a token is opaque. Splitting on the
  // FIRST `=` is what keeps it whole, exactly as the app's own reader of a container's environment does.
  it("keeps a value that contains the separator", () => {
    expect(parseEnvFile("CD_UPSTREAM_BASE_URL=http://127.0.0.1:1234/v1")).toEqual({
      CD_UPSTREAM_BASE_URL: "http://127.0.0.1:1234/v1",
    });
  });

  it("survives the line endings a Windows host may have introduced", () => {
    expect(parseEnvFile("CD_MODEL_ID=a\r\nCD_WORKSPACE=/workspace\r\n")).toEqual({
      CD_MODEL_ID: "a",
      CD_WORKSPACE: "/workspace",
    });
  });

  // Nothing in the app's format needs them, and a line with no name is not a variable.
  it("ignores blank lines and anything with no name", () => {
    expect(parseEnvFile("\n\n=orphan\nCD_A=1\n   \n")).toEqual({ CD_A: "1" });
  });

  // An empty value is a real answer for a var the composer emits unconditionally, and must not read as unset.
  it("keeps a name whose value is empty", () => {
    expect(parseEnvFile("CD_A=")).toEqual({ CD_A: "" });
  });
});
