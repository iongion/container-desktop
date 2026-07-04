import { describe, expect, it } from "vitest";

import { isSoftwareRenderer, type RendererProbe, shouldUseWebglRenderer } from "./terminalRenderer";

describe("isSoftwareRenderer", () => {
  it("flags Mesa llvmpipe (WebKitGTK software fallback)", () => {
    expect(isSoftwareRenderer("Mesa/X.org, llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
  });

  it("flags SwiftShader (ANGLE software backend)", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3 (SwiftShader Device (LLVM 10.0.0)))")).toBe(true);
  });

  it("flags Microsoft Basic Render Driver (Windows GPU-less)", () => {
    expect(isSoftwareRenderer("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)")).toBe(true);
  });

  it("passes real hardware GPUs (NVIDIA / Intel / Apple)", () => {
    expect(isSoftwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0)")).toBe(false);
    expect(isSoftwareRenderer("ANGLE (Intel, Mesa Intel(R) Graphics (ADL GT2))")).toBe(false);
    expect(isSoftwareRenderer("Apple GPU")).toBe(false);
  });
});

function probeReporting(renderer: string | null): RendererProbe {
  const UNMASKED = 0x9246;
  return {
    getExtension: (name) => (name === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: UNMASKED } : null),
    getParameter: (parameter) => (parameter === UNMASKED ? renderer : null),
  };
}

describe("shouldUseWebglRenderer", () => {
  it("uses WebGL on a hardware GPU", () => {
    expect(shouldUseWebglRenderer(probeReporting("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0)"))).toBe(
      true,
    );
  });

  it("falls back to DOM on a software renderer", () => {
    expect(shouldUseWebglRenderer(probeReporting("llvmpipe (LLVM 15.0.7, 256 bits)"))).toBe(false);
  });

  it("falls back to DOM when there is no GL context", () => {
    expect(shouldUseWebglRenderer(null)).toBe(false);
  });

  it("falls back to DOM when the renderer string is masked (no debug extension)", () => {
    const masked: RendererProbe = { getExtension: () => null, getParameter: () => "" };
    expect(shouldUseWebglRenderer(masked)).toBe(false);
  });

  it("falls back to DOM when the renderer string is empty", () => {
    expect(shouldUseWebglRenderer(probeReporting(""))).toBe(false);
  });
});
