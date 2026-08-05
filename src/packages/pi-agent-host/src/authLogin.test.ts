import type { AuthInteraction, OAuthAuth, OAuthCredential } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import { attachLoginConnection, createProviderLoginRunner, type LoginCapableProvider } from "@/pi-agent-host/authLogin";
import { encodeCommand } from "@/pi-bridge/codec";
import type { BridgeEvent } from "@/pi-bridge/protocol";

// A stand-in for pi's own flow: it asks whatever the test wants asked, then answers with a credential. The real
// flows cannot be exercised here — they open loopback servers and talk to a provider — but the CONTRACT they are
// called through is exactly this one.
function flowProvider(login: OAuthAuth["login"]): LoginCapableProvider {
  return {
    id: "openrouter",
    name: "OpenRouter",
    auth: {
      oauth: {
        name: "OpenRouter OAuth",
        loginLabel: "Sign in with OpenRouter",
        login,
        refresh: async (credential) => credential,
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
    },
  };
}

const KEY: OAuthCredential = { type: "oauth", access: "sk-or-v1", refresh: "", expires: Number.MAX_SAFE_INTEGER };

function runner(provider: LoginCapableProvider | undefined) {
  const events: BridgeEvent[] = [];
  const instance = createProviderLoginRunner({
    emit: (event) => events.push(event),
    findProvider: () => provider,
  });
  return { instance, events };
}

const prompts = (events: BridgeEvent[]) => events.filter((event) => event.type === "auth_prompt");

describe("createProviderLoginRunner", () => {
  it("carries pi's prompt to the app and pi's answer back into the flow", async () => {
    let asked: string | undefined;
    const { instance, events } = runner(
      flowProvider(async (interaction: AuthInteraction) => {
        asked = await interaction.prompt({
          type: "manual_code",
          message: "paste the redirect URL",
          placeholder: "url",
        });
        return KEY;
      }),
    );
    const outcome = instance.login("openrouter");
    await vi.waitFor(() => expect(prompts(events)).toHaveLength(1));
    const prompt = prompts(events)[0] as Extract<BridgeEvent, { type: "auth_prompt" }>;
    expect(prompt.prompt).toEqual({ type: "manual_code", message: "paste the redirect URL", placeholder: "url" });
    instance.answerPrompt(prompt.promptId, true, "https://cb?code=xyz");
    await expect(outcome).resolves.toEqual({
      ok: true,
      credential: { access: "sk-or-v1", refresh: "", expires: Number.MAX_SAFE_INTEGER },
    });
    expect(asked).toBe("https://cb?code=xyz");
  });

  // pi's select prompt is the one with structure — its options carry an id, a label and a description, and the id is
  // what the flow reads back.
  it("carries a select prompt's options and answers with the chosen id", async () => {
    const { instance, events } = runner(
      flowProvider(async (interaction: AuthInteraction) => {
        const chosen = await interaction.prompt({
          type: "select",
          message: "How do you want to sign in?",
          options: [
            { id: "oauth", label: "Sign in with OpenRouter", description: "browser" },
            { id: "key", label: "Paste an API key" },
          ],
        });
        return { ...KEY, access: chosen };
      }),
    );
    const outcome = instance.login("openrouter");
    await vi.waitFor(() => expect(prompts(events)).toHaveLength(1));
    const prompt = prompts(events)[0] as Extract<BridgeEvent, { type: "auth_prompt" }>;
    expect(prompt.prompt).toEqual({
      type: "select",
      message: "How do you want to sign in?",
      options: [
        { id: "oauth", label: "Sign in with OpenRouter", description: "browser" },
        { id: "key", label: "Paste an API key" },
      ],
    });
    instance.answerPrompt(prompt.promptId, true, "oauth");
    await expect(outcome).resolves.toMatchObject({ ok: true, credential: { access: "oauth" } });
  });

  // pi aborts its manual-paste prompt the instant the loopback callback wins the race. Without the withdrawal frame
  // the app would go on asking for a code the login has already stopped needing.
  it("withdraws a prompt the flow abandons", async () => {
    const abort = new AbortController();
    const { instance, events } = runner(
      flowProvider(async (interaction: AuthInteraction) => {
        const pending = interaction.prompt({ type: "manual_code", message: "paste", signal: abort.signal });
        abort.abort();
        await pending.catch(() => undefined);
        return KEY;
      }),
    );
    const outcome = instance.login("openrouter");
    await vi.waitFor(() => expect(events.some((event) => event.type === "auth_prompt_closed")).toBe(true));
    await expect(outcome).resolves.toMatchObject({ ok: true });
  });

  it("emits pi's own progress and auth-url events as they happen", async () => {
    const { instance, events } = runner(
      flowProvider(async (interaction: AuthInteraction) => {
        interaction.notify({ type: "progress", message: "Listening for OpenRouter OAuth callback" });
        interaction.notify({ type: "auth_url", url: "https://openrouter.ai/auth?x=1", instructions: "open it" });
        interaction.notify({ type: "info", message: "docs", links: [{ url: "https://openrouter.ai", label: "site" }] });
        return KEY;
      }),
    );
    await expect(instance.login("openrouter")).resolves.toMatchObject({ ok: true });
    expect(events.filter((event) => event.type === "auth_event")).toEqual([
      { type: "auth_event", event: { type: "progress", message: "Listening for OpenRouter OAuth callback" } },
      {
        type: "auth_event",
        event: { type: "auth_url", url: "https://openrouter.ai/auth?x=1", instructions: "open it" },
      },
      {
        type: "auth_event",
        event: { type: "info", message: "docs", links: [{ url: "https://openrouter.ai", label: "site" }] },
      },
    ]);
  });

  it("reports a cancelled prompt as the flow's own failure, not as a crash", async () => {
    const { instance, events } = runner(
      flowProvider(async (interaction: AuthInteraction) => {
        await interaction.prompt({ type: "secret", message: "Enter the key" });
        return KEY;
      }),
    );
    const outcome = instance.login("openrouter");
    await vi.waitFor(() => expect(prompts(events)).toHaveLength(1));
    const prompt = prompts(events)[0] as Extract<BridgeEvent, { type: "auth_prompt" }>;
    instance.answerPrompt(prompt.promptId, false);
    await expect(outcome).resolves.toEqual({ ok: false, error: "cancelled" });
  });

  it("says so when pi ships no such provider, or ships one with no login", async () => {
    await expect(runner(undefined).instance.login("nope")).resolves.toEqual({
      ok: false,
      error: "pi ships no provider called nope",
    });
    await expect(runner({ id: "deepseek", name: "DeepSeek", auth: {} }).instance.login("deepseek")).resolves.toEqual({
      ok: false,
      error: "DeepSeek has no sign-in flow",
    });
  });

  it("refuses a second login while one is running", async () => {
    const { instance, events } = runner(
      flowProvider(async (interaction: AuthInteraction) => {
        await interaction.prompt({ type: "text", message: "wait" });
        return KEY;
      }),
    );
    const first = instance.login("openrouter");
    await vi.waitFor(() => expect(prompts(events)).toHaveLength(1));
    await expect(instance.login("openrouter")).resolves.toEqual({
      ok: false,
      error: "a sign-in is already running",
    });
    instance.answerPrompt((prompts(events)[0] as Extract<BridgeEvent, { type: "auth_prompt" }>).promptId, false);
    await first;
  });
});

describe("attachLoginConnection", () => {
  function attached(provider: LoginCapableProvider) {
    const frames: string[] = [];
    const connection = { send: (frame: string) => frames.push(frame), close: vi.fn() };
    const channel = attachLoginConnection(connection, { token: "tok", findProvider: () => provider });
    return { channel, frames, connection };
  }

  const hello = encodeCommand({ id: "h1", type: "hello", token: "tok", protocolVersion: 1 });

  it("answers the handshake and announces no session, because it has none", async () => {
    const { channel, frames } = attached(flowProvider(async () => KEY));
    await channel.handleFrame(hello);
    expect(frames.map((frame) => JSON.parse(frame))).toEqual([{ type: "response", id: "h1", success: true }]);
  });

  it("refuses every command that belongs to a session", async () => {
    const { channel, frames } = attached(flowProvider(async () => KEY));
    await channel.handleFrame(hello);
    await channel.handleFrame(encodeCommand({ id: "p1", type: "prompt", text: "hello" }));
    expect(JSON.parse(frames[1])).toMatchObject({
      type: "response",
      id: "p1",
      success: false,
      error: "this container only performs a provider sign-in, not prompt",
    });
  });

  it("runs the login over the socket and answers with the outcome", async () => {
    const { channel, frames } = attached(flowProvider(async () => KEY));
    await channel.handleFrame(hello);
    await channel.handleFrame(encodeCommand({ id: "l1", type: "auth_login", provider: "openrouter" }));
    expect(JSON.parse(frames[1])).toMatchObject({
      type: "response",
      id: "l1",
      success: true,
      result: { ok: true, credential: { access: "sk-or-v1" } },
    });
  });

  it("will not run a login for an unauthenticated peer", async () => {
    const { channel, frames, connection } = attached(flowProvider(async () => KEY));
    await channel.handleFrame(encodeCommand({ id: "l1", type: "auth_login", provider: "openrouter" }));
    expect(JSON.parse(frames[0])).toMatchObject({ id: "l1", success: false, error: "handshake required" });
    await channel.handleFrame(encodeCommand({ id: "h2", type: "hello", token: "wrong", protocolVersion: 1 }));
    expect(connection.close).toHaveBeenCalledWith(4401, "unauthorized");
  });
});
