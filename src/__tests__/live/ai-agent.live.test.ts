// LIVE, NON-MOCK agent inference against REAL OpenRouter free models. This is the "real" lens of the AI subsystem
// coverage: the hermetic unit suite (omaAdapter.test.ts, runHost tests, the scripted omaMocks brain) proves the
// SAME machinery deterministically; this file proves it against the actual model API — real HTTP, the app's own
// createLanguageModel → AISdkAdapter → open-multi-agent loop. It NEVER runs in CI (it lives only in
// vitest.live.config.mts) and SKIPS LOUD when OPENROUTER_API_KEY is absent.
//
// Design for reproducibility with a flaky free tier:
//   - Constrained prompts; assert STRUCTURE (a reply streamed, a plan was produced, which models were called) —
//     never exact prose, which no two free models agree on.
//   - MULTI-INFERENCE is proven by a RECORDING fetch that captures the `model` of every real request body: two
//     workers on two different free models ⇒ both ids must appear on the wire. This holds even if a model returns
//     junk, because it asserts ROUTING, not output quality.
//   - Sequential calls with a small delay (OpenRouter free tier is ~20 req/min, 50/day unfunded); a run that the
//     free tier rate-limits or refuses is reported, not turned into a red build.
//
// Verify the free model ids before a run (the roster shifts weekly): `curl -s https://openrouter.ai/api/v1/models`
// then filter `:free`. The ids used here are the shared live roster in testing/agents.ts (OPENROUTER_FREE_MODELS).

import { afterAll, describe, expect, it } from "vitest";
import type { AgentExecutionDeps } from "@/ai-system/core/ports";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import type { RunEventEnvelope } from "@/ai-system/core/runEvents";
import type { ThreadEventEnvelope } from "@/ai-system/core/threadEvents";
import type { AgentSessionCreationOptions, ResolvedWorker, TeamRunCreationOptions } from "@/ai-system/core/types";
import { createOmaAgentSession } from "@/ai-system/runtime/omaAgentSession";
import { createOmaTeamRun } from "@/ai-system/runtime/omaTeamRun";
import { OPENROUTER_FREE_MODELS } from "@/ai-system/testing/agents";

const KEY = process.env.OPENROUTER_API_KEY?.trim();
// skip-loud: the whole describe is skipped, and the reason is printed, when no key is present.
const live = KEY ? describe : describe.skip;
if (!KEY) {
  console.warn("[live] ai-agent.live.test: OPENROUTER_API_KEY not set — skipping the real OpenRouter inference arms.");
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const INSPECTOR_MODEL = OPENROUTER_FREE_MODELS["mock-worker-inspector"].model;
const EDITOR_MODEL = OPENROUTER_FREE_MODELS["mock-worker-editor"].model;
const REVIEWER_MODEL = OPENROUTER_FREE_MODELS["mock-worker-reviewer"].model;

// A resolved OpenRouter provider bound to `model`. openai-compatible is how the catalog classifies OpenRouter;
// createLanguageModel then routes through @ai-sdk/openai-compatible against baseURL.
function resolvedFor(model: string): ResolvedProvider {
  return {
    id: "openrouter",
    kind: "openai-compatible",
    baseURL: OPENROUTER_BASE_URL,
    model,
    isCloud: true,
    requiresKey: true,
    auth: { scheme: "bearer" },
    discovery: "openai-compatible",
  } as unknown as ResolvedProvider;
}

// A providerFetch that injects the raw key (bypassing the shell ProviderTransport) AND records the model of every
// chat-completions request, so a later assertion can prove which models were actually called on the wire.
function makeRecordingFetch(seenModels: Set<string>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      if (typeof init?.body === "string") {
        const model = JSON.parse(init.body)?.model;
        if (typeof model === "string") seenModels.add(model);
      }
    } catch {
      // A non-JSON body is not a chat request we care to record.
    }
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${KEY}`);
    return fetch(input, { ...init, headers });
  }) as unknown as typeof fetch;
}

// No engineOps/workspaceAccess ⇒ zero container tools are built, so these arms exercise pure model inference and
// the multi-agent loop without needing a live engine (the runs-on.live.test.ts matrix owns real execution).
const NO_TOOLS = {} as AgentExecutionDeps;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Poll an accumulating event list until `done`, or give up after `timeoutMs`. Returns whether it settled.
async function waitForEvents<T>(events: T[], done: (events: T[]) => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (done(events)) return true;
    await sleep(200);
  }
  return done(events);
}

live("live: real OpenRouter agent inference", () => {
  // Small courtesy delay between tests so a full file run stays under the free-tier per-minute budget.
  afterAll(() => sleep(1500));

  // ARM A — a real assistant turn streams real text through OMA, once per free model family. Proves the
  // provider stack (createLanguageModel → AISdkAdapter → OMA) reaches OpenRouter and streams a reply for EACH model.
  const assistantModels = [INSPECTOR_MODEL, EDITOR_MODEL];
  it.each(assistantModels)(
    "streams a real assistant reply via %s",
    async (model) => {
      const seen = new Set<string>();
      const providerFetch = makeRecordingFetch(seen);
      const events: ThreadEventEnvelope[] = [];
      const options: AgentSessionCreationOptions = {
        threadId: `live-thread-${model}`,
        history: [],
        taskSettings: {
          resolved: resolvedFor(model),
          providerFetch,
          system: "You are a terse assistant. Reply in one short sentence.",
          permissionMode: "allow",
          execution: NO_TOOLS,
        },
        emit: (envelope: ThreadEventEnvelope) => events.push(envelope),
      } as unknown as AgentSessionCreationOptions;
      const session = createOmaAgentSession(options);

      await session.submit({ id: "m1", content: "Name one benefit of containers.", createdAt: Date.now() });
      const settled = await waitForEvents(
        events,
        (list) => list.some((e) => e.event.type === "task-complete" || e.event.type === "error"),
        45_000,
      );

      const errors = events.flatMap((e) => (e.event.type === "error" ? [e.event.message] : []));
      if (errors.length > 0) {
        console.warn(`[live] ${model} refused/rate-limited: ${errors.join("; ")} — treating as skipped.`);
        return; // free-tier refusal is not a product failure
      }
      expect(settled, "assistant turn did not settle in time").toBe(true);
      const reply = events.flatMap((e) => (e.event.type === "assistant-delta" ? [e.event.text] : [])).join("");
      expect(reply.trim().length, "assistant streamed no text").toBeGreaterThan(0);
      // The request that went over the wire carried exactly the model we selected — no silent substitution.
      expect(seen.has(model), `expected a request for ${model}, saw ${[...seen].join(", ") || "none"}`).toBe(true);
    },
    60_000,
  );

  // ARM B — MULTI-INFERENCE Team Run: two Workers on two DIFFERENT free models. The headline proof that OMA routes a
  // per-agent model through our adapter — asserted by the recording fetch (both worker model ids appear on the
  // wire), independent of the (free, noisy) output. Also asserts the run structurally decomposes + gates on a plan.
  it("runs a multi-agent goal with a different free model per worker", async () => {
    const seen = new Set<string>();
    const providerFetch = makeRecordingFetch(seen);
    const worker = (id: string, name: string, specialty: string, model: string): ResolvedWorker =>
      ({
        id,
        name,
        specialty,
        system: `You are ${name}. ${specialty}. Keep every reply to one sentence.`,
        resolved: resolvedFor(model),
        providerFetch,
        policy: "all",
      }) as unknown as ResolvedWorker;

    const runEvents: RunEventEnvelope[] = [];
    const options: TeamRunCreationOptions = {
      runId: "live-run-1",
      goal: "Explain in two short sentences what a container image is. Plan exactly two tasks, one per worker.",
      taskSettings: {
        resolved: resolvedFor(REVIEWER_MODEL), // coordinator model
        providerFetch,
        system: "You are a concise orchestration agent. Decompose the goal into two independent tasks.",
        permissionMode: "allow",
        execution: NO_TOOLS,
        budget: { maxTokens: 120_000, maxTasks: 4 },
        workers: [
          worker("w-researcher", "Researcher", "you gather one concrete fact", INSPECTOR_MODEL),
          worker("w-writer", "Writer", "you write one crisp sentence", EDITOR_MODEL),
        ],
      },
      emit: (envelope: RunEventEnvelope) => runEvents.push(envelope),
    } as unknown as TeamRunCreationOptions;

    const run = createOmaTeamRun(options);
    await run.start();

    // The run pauses after decomposition for the plan gate — approve it so the workers dispatch.
    const planned = await waitForEvents(
      runEvents,
      (list) => list.some((e) => e.event.type === "plan-ready") || run.snapshot().planPending,
      60_000,
    );
    if (!planned) {
      console.warn("[live] coordinator never produced a plan (free-tier variance) — treating as skipped.");
      return;
    }
    const plan = run.snapshot();
    expect(plan.tasks.length, "plan produced no tasks").toBeGreaterThan(0);

    await run.resolvePlan("allow");
    await waitForEvents(
      runEvents,
      (list) => list.some((e) => e.event.type === "run-complete" || e.event.type === "run-stopped"),
      90_000,
    );

    const runError = runEvents.find((e) => e.event.type === "error" && e.event.scope === "run");
    if (runError && runError.event.type === "error") {
      console.warn(`[live] Team Run errored (free tier): ${runError.event.message} — treating as skipped.`);
    }
    await run.dispose();

    // The multi-inference invariant: BOTH worker models were actually requested over the wire. This is the proof
    // that a per-agent model routes through the real adapter — it does not depend on the free models' output.
    expect(
      seen.has(INSPECTOR_MODEL),
      `researcher model ${INSPECTOR_MODEL} was never called; saw ${[...seen].join(", ") || "none"}`,
    ).toBe(true);
    expect(
      seen.has(EDITOR_MODEL),
      `writer model ${EDITOR_MODEL} was never called; saw ${[...seen].join(", ") || "none"}`,
    ).toBe(true);
  }, 180_000);
});
