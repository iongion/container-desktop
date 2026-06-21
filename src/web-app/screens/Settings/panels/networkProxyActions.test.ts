import { describe, expect, it } from "vitest";
import { normalizeProxyConfig } from "@/container-client/proxy";
import { saveProxyAfterReachabilityTest } from "./networkProxyActions";

describe("saveProxyAfterReachabilityTest", () => {
  const proxy = normalizeProxyConfig({
    mode: "manual",
    protocol: "http",
    host: "proxy.example.com",
    port: 8080,
  });

  it("tests reachability before saving", async () => {
    const calls: string[] = [];
    const result = await saveProxyAfterReachabilityTest(proxy, {
      testProxyConnectivity: async () => {
        calls.push("test");
        return { ok: true };
      },
      setGlobalUserSettings: async () => {
        calls.push("save");
      },
    });

    expect(result.saved).toBe(true);
    expect(calls).toEqual(["test", "save"]);
  });

  it("does not save when the reachability test fails", async () => {
    const calls: string[] = [];
    const result = await saveProxyAfterReachabilityTest(proxy, {
      testProxyConnectivity: async () => {
        calls.push("test");
        return { ok: false, error: "Connection failed." };
      },
      setGlobalUserSettings: async () => {
        calls.push("save");
      },
    });

    expect(result).toMatchObject({ saved: false, reason: "unreachable" });
    expect(calls).toEqual(["test"]);
  });

  it("does not test or save invalid proxy settings", async () => {
    const calls: string[] = [];
    const result = await saveProxyAfterReachabilityTest(
      normalizeProxyConfig({
        mode: "manual",
        protocol: "http",
        host: "",
        port: 0,
      }),
      {
        testProxyConnectivity: async () => {
          calls.push("test");
          return { ok: true };
        },
        setGlobalUserSettings: async () => {
          calls.push("save");
        },
      },
    );

    expect(result).toMatchObject({ saved: false, reason: "invalid" });
    expect(calls).toEqual([]);
  });
});
