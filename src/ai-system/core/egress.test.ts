import { describe, expect, it } from "vitest";

import { evaluateEgress, isLoopbackHost, isOffDeviceURL, previewOutbound } from "./egress";

describe("isLoopbackHost", () => {
  it("treats localhost and the 127.0.0.0/8 range as loopback", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.5.6.7")).toBe(true);
  });

  it("treats IPv6 loopback as loopback", () => {
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("treats LAN and public hosts as NON-loopback", () => {
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
    expect(isLoopbackHost("10.0.0.5")).toBe(false);
    expect(isLoopbackHost("api.openai.com")).toBe(false);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });
});

describe("isOffDeviceURL", () => {
  it("loopback base URLs stay on-device", () => {
    expect(isOffDeviceURL("http://127.0.0.1:8080/v1")).toBe(false);
    expect(isOffDeviceURL("http://localhost:1234/v1")).toBe(false);
  });

  it("a local provider pointed at a LAN/public host is off-device", () => {
    expect(isOffDeviceURL("http://192.168.1.5:8080/v1")).toBe(true);
    expect(isOffDeviceURL("https://api.openai.com/v1")).toBe(true);
  });

  it("an unparseable URL is treated as off-device (fail safe)", () => {
    expect(isOffDeviceURL("not a url")).toBe(true);
  });
});

describe("evaluateEgress", () => {
  // Cloud consent is now expressed by saving the provider's API key (a cloud provider with no key is
  // blocked by the broker's key check) or by typing an off-device URL for a local provider. So egress is
  // a pure off-device CLASSIFIER — it no longer gates; loopback stays on-device, everything else is allowed.
  it("classifies a loopback call as on-device and allowed", () => {
    expect(evaluateEgress({ baseURL: "http://127.0.0.1:8080/v1" })).toEqual({
      offDevice: false,
      allowed: true,
      requiresConsent: false,
    });
  });

  it("classifies an off-device call as off-device but allowed (consent is the saved key / typed URL)", () => {
    expect(evaluateEgress({ baseURL: "https://api.openai.com/v1" })).toEqual({
      offDevice: true,
      allowed: true,
      requiresConsent: false,
    });
    expect(evaluateEgress({ baseURL: "http://192.168.1.5:8080/v1" }).offDevice).toBe(true);
  });
});

describe("previewOutbound", () => {
  it("returns the exact redacted payload that would be sent", () => {
    const preview = previewOutbound({ model: "claude-x", apiKey: "sk-ant-secret", messages: ["hi"] });
    expect(preview.text).toContain("[REDACTED]");
    expect(preview.text).not.toContain("sk-ant-secret");
    expect(preview.payload.model).toBe("claude-x");
  });
});
