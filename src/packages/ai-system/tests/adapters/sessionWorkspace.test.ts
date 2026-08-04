import { afterEach, describe, expect, it } from "vitest";

import { bindSessionWorkspace, sessionWorkspaceRoot } from "@/ai-system/adapters/sessionWorkspace";

describe("sessionWorkspaceRoot", () => {
  afterEach(() => {
    bindSessionWorkspace(undefined);
  });

  it("uses the configured workspace when no session is running", async () => {
    const resolve = sessionWorkspaceRoot(() => "/settings/root");
    expect(await resolve()).toBe("/settings/root");
    bindSessionWorkspace(() => undefined);
    expect(await resolve()).toBe("/settings/root");
  });

  // The session mounts the folder chosen in the start drawer, which is independent of Settings → AI. Everything
  // the app does on the agent's behalf has to act on the folder the container actually has.
  it("prefers the workspace the running session mounted", async () => {
    let mounted: string | undefined = "/mounted/by/session";
    const resolve = sessionWorkspaceRoot(() => "/settings/root");
    bindSessionWorkspace(() => mounted);
    expect(await resolve()).toBe("/mounted/by/session");
    // Read per call, not captured: stopping the session must hand the folder back to Settings with no bookkeeping.
    mounted = undefined;
    expect(await resolve()).toBe("/settings/root");
  });

  it("treats a blank session path as no session at all", async () => {
    const resolve = sessionWorkspaceRoot(() => "/settings/root");
    bindSessionWorkspace(() => "   ");
    expect(await resolve()).toBe("/settings/root");
  });

  it("answers nothing when neither the session nor the settings name a folder", async () => {
    const resolve = sessionWorkspaceRoot(() => undefined);
    expect(await resolve()).toBeUndefined();
  });

  it("awaits an asynchronous fallback", async () => {
    const resolve = sessionWorkspaceRoot(async () => "/from/settings/store");
    expect(await resolve()).toBe("/from/settings/store");
  });
});
