import { describe, expect, it, vi } from "vitest";
import { createTauriDnsResolve } from "./dns";
import type { TauriInvoke } from "./invoke";

describe("createTauriDnsResolve", () => {
  it("resolves a hostname via the dns_lookup command", async () => {
    const invoke = vi.fn(async () => ["93.184.216.34"]);
    const resolve = createTauriDnsResolve(invoke as unknown as TauriInvoke);
    expect(await resolve("example.com")).toEqual(["93.184.216.34"]);
    expect(invoke).toHaveBeenCalledWith("dns_lookup", { hostname: "example.com" });
  });
});
