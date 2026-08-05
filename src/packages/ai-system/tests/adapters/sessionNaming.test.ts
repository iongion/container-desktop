import { describe, expect, it } from "vitest";

import {
  AI_SESSION_LABEL,
  ASSISTANT_PLUGIN_VOLUME,
  ASSISTANT_PROJECT,
  assistantContainerName,
  assistantFilterArgv,
  assistantLabels,
  assistantNetworkName,
  defaultScope,
  egressNetworkOf,
} from "@/ai-system/adapters/sessionNaming";

describe("assistant resource names", () => {
  // Compose's own grammar, under one project, so what belongs together reads as belonging together in `podman ps`.
  it("names every resource under one project", () => {
    const scope = defaultScope("podman-1");
    expect(assistantContainerName("agent", scope)).toBe("container-desktop-agent-default-podman-1");
    expect(assistantContainerName("gateway", scope)).toBe("container-desktop-gateway-default-podman-1");
    expect(assistantNetworkName(scope)).toBe("container-desktop-net-default-podman-1");
    for (const name of [assistantContainerName("agent", scope), assistantNetworkName(scope)]) {
      expect(name.startsWith(`${ASSISTANT_PROJECT}-`)).toBe(true);
    }
  });

  it("gives the same connection the same scope every time", () => {
    expect(defaultScope("docker-2")).toBe(defaultScope("docker-2"));
  });

  it("folds a connection id the engine would refuse into a legal name", () => {
    expect(assistantContainerName("agent", defaultScope("Podman Machine #1"))).toMatch(
      /^container-desktop-agent-default-[a-z0-9][a-z0-9_.-]*$/,
    );
  });

  it("still tells apart two ids that fold to the same text", () => {
    expect(defaultScope("Podman 1")).not.toBe(defaultScope("podman 1"));
  });

  it("names the egress network after the one it accompanies", () => {
    expect(egressNetworkOf("container-desktop-net-default-podman-1")).toBe(
      "container-desktop-net-default-podman-1-egress",
    );
  });

  // Renaming this volume would present pi with an empty agent directory: the user's installed plugins and every
  // stored conversation live in it. A future tidy-up that "fixes" the inconsistent name would delete their history.
  it("keeps the plugin volume's existing name, whatever the project is called", () => {
    expect(ASSISTANT_PLUGIN_VOLUME).toBe("cd-agent-plugins");
  });
});

describe("assistant resource labels", () => {
  // The compose pair is what makes these containers GROUP — in this app's Containers screen, and in every other tool
  // that reads compose labels. The app's own pair is what makes them identifiable, which compose cannot express.
  it("stamps the compose group and the app's own identity", () => {
    expect(assistantLabels({ kind: "default", role: "agent", connectionId: "podman-1" })).toEqual({
      "com.docker.compose.project": "container-desktop",
      "com.docker.compose.service": "agent",
      [AI_SESSION_LABEL.session]: "default",
      [AI_SESSION_LABEL.role]: "agent",
      [AI_SESSION_LABEL.connection]: "podman-1",
    });
  });

  // The reason identity lives in a label at all: no charset to respect, so the id tracked here is the id used
  // everywhere else in the app.
  it("carries the connection id verbatim, however it is written", () => {
    expect(assistantLabels({ kind: "default", role: "agent", connectionId: "Podman Machine #1" })).toMatchObject({
      [AI_SESSION_LABEL.connection]: "Podman Machine #1",
    });
  });

  it("groups a login container under the same project", () => {
    expect(assistantLabels({ kind: "ephemeral", role: "login" })).toMatchObject({
      "com.docker.compose.project": "container-desktop",
      "com.docker.compose.service": "login",
      [AI_SESSION_LABEL.session]: "ephemeral",
    });
  });

  it("asks the engine to select one connection's reusable session", () => {
    expect(assistantFilterArgv({ kind: "default", connectionId: "podman-1" })).toEqual([
      "--filter",
      `label=${AI_SESSION_LABEL.session}=default`,
      "--filter",
      `label=${AI_SESSION_LABEL.connection}=podman-1`,
    ]);
  });

  it("selects every ephemeral session when no connection is named", () => {
    expect(assistantFilterArgv({ kind: "ephemeral" })).toEqual([
      "--filter",
      `label=${AI_SESSION_LABEL.session}=ephemeral`,
    ]);
  });
});
