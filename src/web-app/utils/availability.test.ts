import { describe, expect, it } from "vitest";

import type { EngineConnectorAvailability } from "@/env/Types";

import { getFirstUnavailableReason } from "./availability";

// Build a fully-available report, then let each test fail one dimension.
function availability(
  overrides: Partial<Omit<EngineConnectorAvailability, "report">> & {
    report?: Partial<EngineConnectorAvailability["report"]>;
  } = {},
): EngineConnectorAvailability {
  const { report, ...rest } = overrides;
  return {
    enabled: true,
    host: true,
    controller: true,
    controllerScope: true,
    program: true,
    api: true,
    ...rest,
    report: {
      host: "Host is available",
      controller: "Controller is available",
      controllerScope: "Controller scope is available",
      program: "Program is available",
      api: "API is running",
      ...(report ?? {}),
    },
  };
}

describe("getFirstUnavailableReason", () => {
  it("returns undefined when the API is running (connected)", () => {
    expect(getFirstUnavailableReason(availability())).toBeUndefined();
  });

  it("returns undefined when availability is missing", () => {
    expect(getFirstUnavailableReason(undefined)).toBeUndefined();
  });

  it("reports the host as the root cause when the host is unreachable", () => {
    const result = getFirstUnavailableReason(
      availability({
        host: false,
        controller: false,
        controllerScope: false,
        program: false,
        api: false,
        report: {
          host: "host unreachable: timeout",
          controller: "Not checked - host not available",
          controllerScope: "Not checked - controller not available",
          program: "Not checked - controller scope not available",
          api: "API is not running",
        },
      }),
    );
    expect(result).toEqual({ dimension: "host", reason: "host unreachable: timeout" });
  });

  it("reports the controller when the host is up but the controller is missing", () => {
    const result = getFirstUnavailableReason(
      availability({
        controller: false,
        controllerScope: false,
        program: false,
        api: false,
        report: { controller: "podman.exe not found in path" },
      }),
    );
    expect(result).toEqual({ dimension: "controller", reason: "podman.exe not found in path" });
  });

  it("reports the program when the scope is up but the program is missing", () => {
    const result = getFirstUnavailableReason(
      availability({
        program: false,
        api: false,
        report: { program: "podman not installed in the distribution" },
      }),
    );
    expect(result).toEqual({ dimension: "program", reason: "podman not installed in the distribution" });
  });

  it("reports the API when everything upstream is available but the socket is down", () => {
    const result = getFirstUnavailableReason(availability({ api: false, report: { api: "podman.sock missing" } }));
    expect(result).toEqual({ dimension: "api", reason: "podman.sock missing" });
  });

  it("skips inapplicable controller/controllerScope dimensions for native hosts", () => {
    // Native hosts have no controller — those booleans are undefined and must NOT be reported as failures.
    const result = getFirstUnavailableReason(
      availability({
        controller: undefined,
        controllerScope: undefined,
        api: false,
        report: {
          controller: undefined,
          controllerScope: undefined,
          api: "API is not running",
        },
      }),
    );
    expect(result).toEqual({ dimension: "api", reason: "API is not running" });
  });
});
