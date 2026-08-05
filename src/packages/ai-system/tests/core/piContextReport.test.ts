import { describe, expect, it } from "vitest";

import { toEffectiveContext, toSessionUsage, undersizedWindow } from "@/ai-system/core/piContextReport";
import type { SessionContextReport } from "@/pi-bridge/protocol";

const report = (patch: Partial<SessionContextReport> = {}): SessionContextReport => ({
  model: "qwen3-4b",
  contextTokens: 5000,
  contextWindow: 128000,
  maxOutputTokens: 4096,
  providerMaxOutputTokens: 0,
  systemPromptChars: 400,
  tools: [
    { name: "read", description: "read a file" },
    { name: "removeContainer", description: "remove a container" },
    { name: "writeFile", description: "write a file" },
    { name: "somePluginTool" },
  ],
  messages: { user: 2, assistant: 3, toolCalls: 4 },
  compacted: false,
  ...patch,
});

const facts = { providerId: "lmstudio", permissionMode: "ask" as const };

describe("toSessionUsage", () => {
  it("carries the session's totals through", () => {
    expect(toSessionUsage({ requests: 3, inputTokens: 1200, outputTokens: 340, costUsd: 0.5 })).toEqual({
      requests: 3,
      inputTokens: 1200,
      outputTokens: 340,
      costs: [{ amount: 0.5, currency: "USD" }],
    });
  });

  // A local model costs nothing to run and publishes no price. An empty list is what makes the panel say so
  // instead of printing a confident zero.
  it("offers no cost at all when nothing was priced", () => {
    expect(toSessionUsage({ requests: 1, inputTokens: 10, outputTokens: 5, costUsd: 0 }).costs).toEqual([]);
  });
});

describe("toEffectiveContext", () => {
  it("classifies every tool by the app's own policy, not by what pi thinks", () => {
    const context = toEffectiveContext(report(), facts, 1000);
    expect(context.tools).toEqual([
      { name: "read", title: "read", description: "read a file", group: "other", gated: false },
      {
        name: "removeContainer",
        title: "removeContainer",
        description: "remove a container",
        group: "container",
        gated: true,
      },
      { name: "writeFile", title: "writeFile", description: "write a file", group: "workspace", gated: true },
      { name: "somePluginTool", title: "somePluginTool", group: "other", gated: true },
    ]);
  });

  it("reserves the model's own output budget out of its window", () => {
    expect(toEffectiveContext(report({ providerMaxOutputTokens: 4096 }), facts, 1000).window).toEqual({
      status: "known",
      maxInputTokens: 128000 - 4096,
      reservedOutputTokens: 4096,
      reservedFromProvider: true,
    });
  });

  // The cap is real — it is what pi registered and what bounds every answer — but nothing on this server said so.
  // Presenting our own default as the provider's is the same fiction the context window used to tell.
  it("says when the reserved output is our default rather than the provider's word", () => {
    expect(toEffectiveContext(report({ providerMaxOutputTokens: 0 }), facts, 1000).window).toEqual({
      status: "known",
      maxInputTokens: 128000 - 4096,
      reservedOutputTokens: 4096,
      reservedFromProvider: false,
    });
  });

  // pi reports 0 for a model it has no window for. Claiming a known window of zero would read as a model with no
  // room at all, which is the opposite of "not published".
  it("reports an unknown window rather than a window of nothing", () => {
    expect(toEffectiveContext(report({ contextWindow: 0 }), facts, 1000).window).toEqual({ status: "unknown" });
  });

  it("accounts for the system prompt, the tools and the conversation separately", () => {
    const context = toEffectiveContext(report(), facts, 1000);
    expect(context.sections.map((section) => section.kind)).toEqual(["system", "tools", "history"]);
    expect(context.sections[0]).toEqual({ kind: "system", items: 1, characters: 400, estimatedTokens: 100 });
    expect(context.sections[1]).toMatchObject({ kind: "tools", items: 4 });
    // Whatever pi's estimate has left once the measured parts are taken out.
    expect(context.sections[2]).toMatchObject({ kind: "history", items: 9 });
    // The budget line shows pi's own number, not the sum of our estimates.
    expect(context.totals.estimatedTokens).toBe(5000);
  });

  it("leaves the conversation out entirely when there is none yet", () => {
    const context = toEffectiveContext(report({ messages: { user: 0, assistant: 0, toolCalls: 0 } }), facts, 1000);
    expect(context.sections.map((section) => section.kind)).toEqual(["system", "tools"]);
  });

  it("falls back to its own arithmetic when pi has no estimate to give", () => {
    const context = toEffectiveContext(report({ contextTokens: null }), facts, 1000);
    expect(context.totals.estimatedTokens).toBe(
      context.sections.reduce((total, section) => total + section.estimatedTokens, 0),
    );
  });

  it("carries the app's own context sources and permission mode, which pi never sees", () => {
    const context = toEffectiveContext(
      report(),
      { ...facts, permissionMode: "remember", sources: [{ kind: "rules", trust: "project", characters: 120 }] },
      1000,
    );
    expect(context.permissionMode).toBe("remember");
    expect(context.sources).toEqual([{ kind: "rules", trust: "project", characters: 120 }]);
  });

  it("says when pi has compacted the session, because part of the history is then a summary", () => {
    expect(toEffectiveContext(report({ compacted: true }), facts, 1000).truncation).toEqual({
      applied: true,
      omittedMessages: 0,
    });
  });
});

// Driven for real: gemma loaded at 4096 against pi's own ~4.6k-token system prompt failed the TURN with llama.cpp's
// words, `n_keep: 4639 >= n_ctx: 4096`. Both numbers were known before the switch.
describe("undersizedWindow", () => {
  // 20000 characters of system prompt is 5000 tokens at the panel's own four-per-token, and the tools add more.
  const session = toEffectiveContext(report({ systemPromptChars: 20_000 }), facts, 1000);

  it("says nothing when the provider published no window, because there is nothing to compare", () => {
    expect(undersizedWindow(session, {})).toBeUndefined();
  });

  it("says nothing when there is no report to compare against yet", () => {
    expect(undersizedWindow(undefined, { contextWindow: 1024 })).toBeUndefined();
  });

  it("answers with both numbers when the window cannot hold the session's own prompt", () => {
    expect(undersizedWindow(session, { contextWindow: 4096 })).toEqual({
      contextWindow: 4096,
      requiredTokens: 9107,
    });
  });

  it("counts the room reserved for the answer, which the model cannot spend on the prompt", () => {
    // 5000 system + 107 tools fits in 8192 on its own; it is the 4096 reserved for an answer that does not.
    expect(undersizedWindow(session, { contextWindow: 8192 })).toMatchObject({ requiredTokens: 9107 });
    expect(undersizedWindow(session, { contextWindow: 16_384 })).toBeUndefined();
  });

  it("uses the cap the provider published for THAT model rather than pi's fallback", () => {
    expect(undersizedWindow(session, { contextWindow: 8192, maxOutputTokens: 1024 })).toBeUndefined();
    expect(undersizedWindow(session, { contextWindow: 8192, maxOutputTokens: 4096 })).toMatchObject({
      requiredTokens: 9107,
    });
  });
});
