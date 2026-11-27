import { afterEach, describe, expect, it } from "vitest";
import {
  getMockEngine,
  getMockEngines,
  isMockMode,
  isUnifiedMock,
  mockProvisionExitCode,
} from "@/container-client/mock/mode";
import { ContainerEngine } from "@/container-client/types/engine";

const ORIGINAL = process.env.CONTAINER_DESKTOP_MOCK;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.CONTAINER_DESKTOP_MOCK;
  } else {
    process.env.CONTAINER_DESKTOP_MOCK = ORIGINAL;
  }
});

function withFlag(value: string) {
  process.env.CONTAINER_DESKTOP_MOCK = value;
}

describe("mock mode flag", () => {
  it("boots the canonical single engines", () => {
    withFlag("podman");
    expect(getMockEngines()).toEqual([ContainerEngine.PODMAN]);
    withFlag("docker");
    expect(getMockEngines()).toEqual([ContainerEngine.DOCKER]);
    withFlag("container");
    expect(getMockEngines()).toEqual([ContainerEngine.APPLE]);
  });

  // The website/screenshot/demo tooling keys the Apple engine by its brand name "container"
  // (asset folders img/container, replays/container.json) while the runtime value is ContainerEngine.APPLE
  // ("container"). The mock gate must accept the brand alias or those pipelines silently boot with
  // no engine (the capture backends set CONTAINER_DESKTOP_MOCK=<engine>).
  it("accepts the 'container' brand alias used by the screenshot/demo tooling", () => {
    withFlag("container");
    expect(isMockMode()).toBe(true);
    expect(getMockEngines()).toEqual([ContainerEngine.APPLE]);
    expect(getMockEngine()).toBe(ContainerEngine.APPLE);
  });

  it("boots the merged set for multi-engine flags", () => {
    withFlag("unified");
    expect(isUnifiedMock()).toBe(true);
    expect(getMockEngines()).toEqual([ContainerEngine.PODMAN, ContainerEngine.DOCKER, ContainerEngine.APPLE]);
  });

  it("is inert for an unknown flag", () => {
    withFlag("nonsense");
    expect(isMockMode()).toBe(false);
    expect(getMockEngines()).toEqual([]);
  });
});

describe("mock provisioning exit knob", () => {
  afterEach(() => {
    delete process.env.CONTAINER_DESKTOP_MOCK_PROVISION_EXIT;
  });

  it("is 0 (every provisioning command succeeds) when unset, zero or not a number", () => {
    expect(mockProvisionExitCode()).toBe(0);
    for (const value of ["0", "abc", "-3"]) {
      process.env.CONTAINER_DESKTOP_MOCK_PROVISION_EXIT = value;
      expect(mockProvisionExitCode()).toBe(0);
    }
  });

  it("is the given code otherwise", () => {
    process.env.CONTAINER_DESKTOP_MOCK_PROVISION_EXIT = "12";
    expect(mockProvisionExitCode()).toBe(12);
  });
});
