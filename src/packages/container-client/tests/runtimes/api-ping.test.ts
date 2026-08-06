import { describe, expect, it, vi } from "vitest";

import { apiPingPolicy, pingUntilAnswered } from "@/container-client/runtimes/api-ping";

// What a liveness ping is allowed to conclude from ONE unanswered request. A native engine answers on a local socket
// in single-digit milliseconds; a SCOPED one answers across whatever the connection crosses — for an SSH remote whose
// engine lives in a machine that is two SSH handshakes and a unix socket, measured at about 1.1s while idle. A single
// 3s attempt is a coin toss against that, and losing it used to cost the whole connection: the caller stops the API,
// which closes the SSH client every engine command travels on, so the assistant's own session died with it.

describe("apiPingPolicy", () => {
  it("keeps the native budget a local socket has always had", () => {
    expect(apiPingPolicy(false).timeoutMs).toBe(3000);
  });

  // Not a round-up for its own sake: the bridge measured ~1.1s idle, and the budget has to survive a slow VM wake or
  // a remote sshd that is briefly refusing new connections, both of which are ordinary and neither of which means the
  // engine is gone.
  it("gives a scoped connection room for the bridge its ping crosses", () => {
    expect(apiPingPolicy(true).timeoutMs).toBeGreaterThan(apiPingPolicy(false).timeoutMs);
  });

  it("retries more than once, whatever the transport", () => {
    expect(apiPingPolicy(true).attempts).toBeGreaterThan(1);
    expect(apiPingPolicy(false).attempts).toBeGreaterThan(1);
  });
});

describe("pingUntilAnswered", () => {
  const policy = { attempts: 3, timeoutMs: 1234, delayMs: 0 };

  it("answers the first success without asking again", async () => {
    const attempt = vi.fn(async () => ({ success: true, details: "Api is reachable" }));

    expect(await pingUntilAnswered(attempt, policy)).toEqual({ success: true, details: "Api is reachable" });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  // The whole point. One unanswered ping is a hiccup, not a dead engine.
  it("believes a failure only after asking again", async () => {
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({ success: false, details: "API is not reachable" })
      .mockResolvedValueOnce({ success: true, details: "Api is reachable" });

    expect(await pingUntilAnswered(attempt, policy)).toMatchObject({ success: true });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("gives up after the last attempt, reporting what the last one said", async () => {
    const attempt = vi.fn(async () => ({ success: false, details: "API is not reachable" }));

    const result = await pingUntilAnswered(attempt, policy);

    expect(result.success).toBe(false);
    expect(result.details).toContain("API is not reachable");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("hands each attempt the budget the policy set", async () => {
    const attempt = vi.fn(async () => ({ success: true, details: "" }));

    await pingUntilAnswered(attempt, policy);

    expect(attempt).toHaveBeenCalledWith(1234);
  });

  // Back to back, three failing attempts would report an outage in the time one used to — the delay is what makes a
  // retry a second chance rather than the same instant asked three times.
  it("waits between attempts", async () => {
    const waited: number[] = [];
    const attempt = vi.fn(async () => ({ success: false, details: "no" }));

    await pingUntilAnswered(attempt, { attempts: 3, timeoutMs: 10, delayMs: 250 }, async (ms) => {
      waited.push(ms);
    });

    // Between the attempts and never after the last one: nothing follows it to wait for.
    expect(waited).toEqual([250, 250]);
  });
});
