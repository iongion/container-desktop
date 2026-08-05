// The skip decisions, tested hermetically — no browser, no machine, no process.
//
// Why these and not the others: a gate that reports "absent" when something IS present skips a spec that would
// have run, and the report then reads like coverage. That direction cannot be proven by running the suite on a
// machine where nothing is up, which is every machine most days — so the decisions are separated from the
// lookups (`ssh -G`, a TCP connect, a fetch) and asserted here.

import { afterEach, describe, expect, it, vi } from "vitest";

import { appModeReason, dialledDestination, envReason, firstReason } from "./prerequisites.js";

describe("dialledDestination", () => {
  it("dials a declared non-default port, not ssh_config's default", () => {
    // The sandbox target: targets.env declares 2222, and `ssh -G 127.0.0.1` answers 22 because it has no entry
    // for a literal address. Trusting ssh here reported a RUNNING sandbox as unreachable.
    const dialled = dialledDestination({ host: "127.0.0.1", port: 2222 }, { hostname: "127.0.0.1", port: "22" });
    expect(dialled).toEqual({ host: "127.0.0.1", port: 2222 });
  });

  it("resolves an alias to the address ssh_config would dial", () => {
    // `win11` is a Host alias; DNS cannot answer it, so the hostname has to come from ssh.
    const dialled = dialledDestination({ host: "win11", port: 22 }, { hostname: "192.168.122.5", port: "22" });
    expect(dialled).toEqual({ host: "192.168.122.5", port: 22 });
  });

  it("takes ssh_config's port when the target declared none of its own", () => {
    // The registry defaults an undeclared port to 22, so 22 means "unstated" — and then ssh_config is the better
    // answer. A Host alias carrying `Port 2200` is reached, instead of being dialled at 22 and called absent.
    const dialled = dialledDestination({ host: "gateway", port: 22 }, { hostname: "10.0.0.9", port: "2200" });
    expect(dialled).toEqual({ host: "10.0.0.9", port: 2200 });
  });

  it("falls back to what the target declared when ssh answers nothing", () => {
    const dialled = dialledDestination({ host: "win11", port: 2222 }, {});
    expect(dialled).toEqual({ host: "win11", port: 2222 });
  });

  it("never dials port 0 when ssh answers something unparseable", () => {
    const dialled = dialledDestination({ host: "box", port: 22 }, { hostname: "box", port: "not-a-port" });
    expect(dialled).toEqual({ host: "box", port: 22 });
  });
});

describe("appModeReason", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats an explicitly EMPTY value as the real app", () => {
    // wdio.conf defaults the var with `??=`, which an empty string survives — that empty value is the only thing
    // distinguishing a real run from a mock one, so reading it as "mock" would skip the whole smoke suite.
    vi.stubEnv("CONTAINER_DESKTOP_MOCK", "");
    expect(appModeReason("real")).toBeUndefined();
    expect(appModeReason("mock")).toMatch(/mock app/);
  });

  it("treats any set value as the mock app, including an engine name", () => {
    for (const value of ["1", "podman", "docker"]) {
      vi.stubEnv("CONTAINER_DESKTOP_MOCK", value);
      expect(appModeReason("real")).toMatch(/NON-mock/);
      expect(appModeReason("mock")).toBeUndefined();
    }
  });
});

describe("envReason", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports the variable by name, with why it is needed", () => {
    vi.stubEnv("CD_TEST_ABSENT_VAR", "");
    expect(envReason("CD_TEST_ABSENT_VAR", "it drives a real model")).toBe(
      "CD_TEST_ABSENT_VAR is not set — it drives a real model",
    );
  });

  it("says nothing when the variable is set", () => {
    vi.stubEnv("CD_TEST_PRESENT_VAR", "x");
    expect(envReason("CD_TEST_PRESENT_VAR", "unused")).toBeUndefined();
  });
});

describe("firstReason", () => {
  it("answers with the first reason and asks nothing after it", async () => {
    // Order is the point: the cheap questions come first so nothing dials a machine whose spec was never going
    // to run — a check that ran anyway would cost a TCP timeout per absent target.
    const asked: string[] = [];
    const reason = await firstReason([
      () => {
        asked.push("first");
        return undefined;
      },
      () => {
        asked.push("second");
        return "the engine is not answering";
      },
      () => {
        asked.push("third");
        return "never reached";
      },
    ]);
    expect(reason).toBe("the engine is not answering");
    expect(asked).toEqual(["first", "second"]);
  });

  it("answers nothing when every check passes", async () => {
    expect(await firstReason([() => undefined, async () => undefined])).toBeUndefined();
  });
});
