import { describe, expect, it } from "vitest";

import { agentImageBuildArgv, resolveAgentImageContext } from "@/cli/lib/agent-image";

describe("agentImageBuildArgv", () => {
  it("builds a tagged image from an explicit dockerfile and context", () => {
    expect(
      agentImageBuildArgv({
        tag: "container-desktop/pi-agent:6.1.0",
        contextDir: "/tmp/ctx",
        dockerfile: "/tmp/ctx/Dockerfile",
      }),
    ).toEqual(["build", "--tag", "container-desktop/pi-agent:6.1.0", "--file", "/tmp/ctx/Dockerfile", "/tmp/ctx"]);
  });
});

describe("resolveAgentImageContext", () => {
  it("uses the repo build directory by default", () => {
    expect(resolveAgentImageContext({ repoRoot: "/repo" })).toBe("/repo/build/agent-image");
  });

  it("prefers an explicit override, which is how a packaged shell will supply it", () => {
    expect(resolveAgentImageContext({ repoRoot: "/repo", override: "/opt/app/agent-image" })).toBe(
      "/opt/app/agent-image",
    );
  });
});
