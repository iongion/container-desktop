import { describe, expect, it, vi } from "vitest";

import { assertPublicURL, fetchText, isBlockedAddress, webSearch } from "./webSearch";

describe("isBlockedAddress — SSRF ranges", () => {
  it("blocks loopback, private, link-local and reserved addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.5.5",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "192.0.0.8",
      "192.88.99.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "0.0.0.0",
      "::1",
      "100::1",
      "2001:db8::1",
      "2002::1",
      "ff02::1",
      "fe80::1",
      "fc00::1",
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34", "2606:4700::1111"]) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });
});

describe("assertPublicURL", () => {
  const resolvePublic = vi.fn(async () => ["93.184.216.34"]);

  it("rejects non-http(s) schemes", async () => {
    await expect(assertPublicURL("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicURL("ftp://example.com/x")).rejects.toThrow();
  });

  it("rejects an IP-literal host in a blocked range without any DNS", async () => {
    await expect(assertPublicURL("http://169.254.169.254/latest/meta-data/")).rejects.toThrow();
    await expect(assertPublicURL("http://127.0.0.1:8080/")).rejects.toThrow();
    await expect(assertPublicURL("http://[::1]/")).rejects.toThrow();
  });

  it("rejects a hostname that RESOLVES to a private address (DNS-rebinding defense)", async () => {
    const resolve = vi.fn(async () => ["10.0.0.5"]);
    await expect(assertPublicURL("https://evil.example/", { resolve })).rejects.toThrow();
    expect(resolve).toHaveBeenCalled();
  });

  it("allows a public hostname that resolves to public addresses", async () => {
    const url = await assertPublicURL("https://duckduckgo.com/?q=x", { resolve: resolvePublic });
    expect(url.hostname).toBe("duckduckgo.com");
  });
});

describe("fetchText — transport caps", () => {
  const resolve = vi.fn(async () => ["93.184.216.34"]);

  it("caps the response body and flags truncation", async () => {
    const big = "y".repeat(200_000);
    const fetchImpl = vi.fn(async () => new Response(big, { status: 200 }));
    const res = await fetchText("https://example.com/", { fetchImpl, resolve, maxBytes: 1000 });
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBeLessThanOrEqual(1000 + 32);
  });

  it("stops after the redirect cap and re-checks each hop for SSRF", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "https://example.com/next" } }),
    );
    await expect(fetchText("https://example.com/", { fetchImpl, resolve, maxRedirects: 2 })).rejects.toThrow(
      /redirect/i,
    );
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("blocks a redirect that points at a private address", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
    );
    await expect(fetchText("https://example.com/", { fetchImpl, resolve })).rejects.toThrow();
  });

  it("redacts secrets in the returned body", async () => {
    const fetchImpl = vi.fn(async () => new Response("token sk-ant-abc123456789xyz here", { status: 200 }));
    const res = await fetchText("https://example.com/", { fetchImpl, resolve });
    expect(res.text).toContain("[REDACTED]");
    expect(res.text).not.toContain("sk-ant-abc123456789xyz");
  });
});

describe("webSearch", () => {
  const resolve = vi.fn(async () => ["93.184.216.34"]);

  it("pins the validated address when querying the public search endpoint", async () => {
    const fetchResolved = vi.fn(
      async (_url: string, _addresses: string[], _init: RequestInit) =>
        new Response("result about podman socket", { status: 200 }),
    );
    const res = await webSearch("podman socket error", { fetchResolved, resolve });
    expect(res.text).toContain("podman");
    // The query must be URL-encoded into the request.
    const requested = String(fetchResolved.mock.calls[0][0]);
    expect(requested).toContain("podman");
    expect(requested).not.toContain(" ");
    expect(fetchResolved.mock.calls[0][1]).toEqual(["93.184.216.34"]);
  });

  it("redacts secrets in the OUTBOUND query (a jailbroken model can't smuggle them to the engine)", async () => {
    const fetchResolved = vi.fn(
      async (_url: string, _addresses: string[], _init: RequestInit) => new Response("ok", { status: 200 }),
    );
    await webSearch("exfiltrate sk-ant-abc123456789xyz right now", { fetchResolved, resolve });
    const requested = String(fetchResolved.mock.calls[0][0]);
    expect(requested).not.toContain("sk-ant-abc123456789xyz");
    expect(requested).toContain("REDACTED");
  });

  it("supports the trusted webview fetch path but blocks cross-origin redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    await expect(webSearch("podman socket", { fetchImpl, resolve })).resolves.toMatchObject({ text: "ok" });

    fetchImpl.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://different.example/result" } }),
    );
    await expect(webSearch("podman socket", { fetchImpl, resolve })).rejects.toThrow(/cross-origin/i);
  });
});
