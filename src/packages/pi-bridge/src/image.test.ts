import { describe, expect, it } from "vitest";

import { AGENT_IMAGE_REPOSITORY, agentImageTag } from "@/pi-bridge/image";

describe("agentImageTag", () => {
  it("tags with the app version", () => {
    expect(agentImageTag("6.1.0")).toBe("container-desktop/pi-agent:6.1.0");
  });

  it("exposes the repository separately for listing and cleanup", () => {
    expect(AGENT_IMAGE_REPOSITORY).toBe("container-desktop/pi-agent");
  });
});
