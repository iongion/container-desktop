import { describe, expect, it } from "vitest";

import { swarmRetry } from "./queries";

// A 5xx from a swarm endpoint is definitive, not transient: Docker answers 503 "this node is not a swarm
// manager" when the engine is not in a swarm, and other 5xx mean the daemon is unhealthy. Retrying on the
// spot only amplifies the failure (and, with the screen's polling, spammed the endless 503 toast storm), so
// swarm reads must NOT retry a 5xx — while still tolerating genuinely transient (network) blips.
describe("swarmRetry — swarm reads never retry a 5xx", () => {
  const err = (status?: unknown) => ({ response: { status } });

  it("never retries a 503 (Docker's not-a-swarm-manager / engine-not-ready)", () => {
    expect(swarmRetry(0, err(503))).toBe(false);
  });

  it("never retries other 5xx", () => {
    expect(swarmRetry(0, err(500))).toBe(false);
    expect(swarmRetry(0, err(502))).toBe(false);
  });

  it("never retries a 5xx whose status arrived as a string across the IPC proxy", () => {
    expect(swarmRetry(0, err("503"))).toBe(false);
  });

  it("never retries auth / not-found", () => {
    expect(swarmRetry(0, err(401))).toBe(false);
    expect(swarmRetry(0, err(403))).toBe(false);
    expect(swarmRetry(0, err(404))).toBe(false);
  });

  it("still retries a genuinely transient error (no http status) a couple of times, then stops", () => {
    const transient = err(undefined); // e.g. a network hiccup — no response status
    expect(swarmRetry(0, transient)).toBe(true);
    expect(swarmRetry(1, transient)).toBe(true);
    expect(swarmRetry(2, transient)).toBe(false);
  });
});
