import { describe, expect, it } from "vitest";

import { getPodLogsViaRest } from "./pods-rest";

// A single Docker/libpod multiplexed log frame: [stream][000][len(4, big-endian)][payload].
function frame(stream: number, text: string): Uint8Array {
  const payload = new TextEncoder().encode(text);
  const out = new Uint8Array(8 + payload.length);
  out[0] = stream;
  const len = payload.length;
  out[4] = (len >>> 24) & 0xff;
  out[5] = (len >>> 16) & 0xff;
  out[6] = (len >>> 8) & 0xff;
  out[7] = len & 0xff;
  out.set(payload, 8);
  return out;
}

describe("getPodLogsViaRest", () => {
  it("aggregates member-container logs, excludes the infra container, and prefixes each line", async () => {
    const driver = {
      get: async (url: string) => {
        if (url.includes("/pods/")) {
          return {
            data: {
              InfraContainerID: "infra1",
              Containers: [
                { Id: "infra1", Name: "proj-infra", State: "running" },
                { Id: "web1", Name: "web", State: "running" },
                { Id: "db1", Name: "db", State: "running" },
              ],
            },
          };
        }
        if (url.includes("/containers/web1/logs")) return { data: frame(1, "hello from web\nsecond line\n") };
        if (url.includes("/containers/db1/logs")) return { data: frame(2, "db ready\n") };
        return { data: new Uint8Array() };
      },
    };
    const res = await getPodLogsViaRest(driver as any, "pod1", 50);
    expect(res.success).toBe(true);
    expect(res.stdout).toContain("web | hello from web");
    expect(res.stdout).toContain("web | second line");
    expect(res.stdout).toContain("db | db ready");
    // The infra (pause) container is never in the output.
    expect(res.stdout).not.toContain("infra");
  });

  it("marks a container whose logs fail as unavailable without aborting the others", async () => {
    const driver = {
      get: async (url: string) => {
        if (url.includes("/pods/")) {
          return {
            data: {
              InfraContainerID: "i",
              Containers: [
                { Id: "i", Name: "infra" },
                { Id: "a", Name: "a" },
                { Id: "b", Name: "b" },
              ],
            },
          };
        }
        if (url.includes("/containers/a/logs")) throw new Error("boom");
        return { data: frame(1, "ok\n") };
      },
    };
    const res = await getPodLogsViaRest(driver as any, "p", 10);
    expect(res.stdout).toContain("a | <logs unavailable>");
    expect(res.stdout).toContain("b | ok");
  });
});
