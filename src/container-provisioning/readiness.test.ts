import { describe, expect, it } from "vitest";

import type { EngineConnectorAvailability } from "@/env/Types";

import { evaluateReadiness } from "./readiness";

function avail(over: Partial<EngineConnectorAvailability> = {}): EngineConnectorAvailability {
  return {
    enabled: true,
    host: true,
    program: true,
    api: true,
    report: { host: "ok", api: "ok", program: "ok" },
    ...over,
  };
}

describe("evaluateReadiness", () => {
  it("native connection: host + program + api → ready, three items, no controller rows", () => {
    const r = evaluateReadiness(avail());
    expect(r.ready).toBe(true);
    expect(r.items.map((i) => i.key)).toEqual(["host", "program", "api"]);
    expect(r.items.every((i) => i.ok)).toBe(true);
  });

  it("scoped connection: adds controller + controllerScope rows", () => {
    const r = evaluateReadiness(
      avail({
        controller: true,
        controllerScope: true,
        report: { host: "ok", api: "ok", program: "ok", controller: "machine up", controllerScope: "scope ok" },
      }),
    );
    expect(r.items.map((i) => i.key)).toEqual(["host", "program", "api", "controller", "controllerScope"]);
    expect(r.ready).toBe(true);
  });

  it("api down → not ready; the api row carries the failure detail", () => {
    const r = evaluateReadiness(
      avail({ api: false, report: { host: "ok", program: "ok", api: "engine not reachable" } }),
    );
    expect(r.ready).toBe(false);
    expect(r.items.find((i) => i.key === "api")).toMatchObject({ ok: false, detail: "engine not reachable" });
  });

  it("a failing controller makes it not ready", () => {
    const r = evaluateReadiness(
      avail({ controller: false, report: { host: "ok", api: "ok", program: "ok", controller: "machine stopped" } }),
    );
    expect(r.ready).toBe(false);
    expect(r.items.find((i) => i.key === "controller")).toMatchObject({ ok: false });
  });
});
