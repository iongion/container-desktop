// The ONE canonical worker roster, shared by the mock app seeding (createMockWorkerStore) and the live agent
// tests (src/__tests__/live/ai-agent.live.test.ts). Single-sourcing the definitions here means the mock and live
// lenses exercise IDENTICAL agents — same names, specialties, system prompts, tool policies and execution
// targets — differing only in which model each worker runs (a scripted mock model vs a real OpenRouter free
// model). Dev/test-only, DCE'd from production like the rest of `testing/`.

import type { WorkerDefinition, WorkerExecutionTarget } from "@/ai-system/core/workers";

// A worker minus the absolute timestamps: ages are days-ago so fixtures never drift into "a year ago". `model`
// here is the DEFAULT (mock/dev) model shown in the UI; the live lens overrides it per worker.
export interface WorkerSpec {
  id: string;
  name: string;
  avatarId?: string;
  specialty: string;
  systemPrompt: string;
  providerId?: string;
  model?: string;
  toolPolicy: WorkerDefinition["toolPolicy"];
  execution: WorkerExecutionTarget;
  createdDaysAgo: number;
  updatedDaysAgo: number;
}

// Four distinct roles that together exercise the whole surface: a read-only inspector (granular allowlist), a
// file editor that runs in a disposable sandbox (ask-mode), a lifecycle operator (all tools), and a config
// reviewer (granular, no model set → inherits). Capped at 10 by the plan; add roles here, both lenses follow.
export const CANONICAL_WORKERS: WorkerSpec[] = [
  {
    id: "mock-worker-inspector",
    name: "Inspector",
    avatarId: "robot-teal",
    specialty: "Reads engine state and reports precisely, never mutates",
    systemPrompt:
      "You inspect the state of container engines and report exactly what you find.\n\nNever mutate anything. If a task requires a change, describe what would need to change and stop.",
    providerId: "openai",
    model: "gpt-4o-mini",
    toolPolicy: {
      mode: "granular",
      allowed: [
        "listConnections",
        "listContainers",
        "inspectContainer",
        "getContainerLogs",
        "listImages",
        "inspectImage",
        "readFile",
        "listDirectory",
      ],
    },
    execution: { kind: "host" },
    createdDaysAgo: 21,
    updatedDaysAgo: 3,
  },
  {
    id: "mock-worker-editor",
    name: "Editor",
    specialty: "Writes and edits files inside the workspace",
    systemPrompt:
      "You make the smallest edit that satisfies the task. Read a file before you change it, and report the diff you applied.",
    providerId: "anthropic",
    model: "claude-sonnet-5",
    toolPolicy: { mode: "ask", allowed: [] },
    execution: { kind: "sandbox", connectionId: "podman", image: "docker.io/library/alpine:3" },
    createdDaysAgo: 18,
    updatedDaysAgo: 3,
  },
  {
    id: "mock-worker-operator",
    name: "Operator",
    specialty: "Starts, stops and prunes containers",
    systemPrompt:
      "You carry out lifecycle operations on containers. Confirm the target by inspecting it first, then act, then report what changed.",
    providerId: "lmstudio",
    model: "qwen2.5-coder-7b",
    toolPolicy: { mode: "all", allowed: [] },
    execution: { kind: "host" },
    createdDaysAgo: 12,
    updatedDaysAgo: 1,
  },
  {
    id: "mock-worker-reviewer",
    name: "Reviewer",
    specialty: "Reviews configuration for risk and reports findings",
    systemPrompt:
      "You review engine and image configuration for security and reliability risk. Rank findings by blast radius and say what you would change.",
    model: "",
    toolPolicy: {
      mode: "granular",
      allowed: ["listContainers", "inspectContainer", "listImages", "inspectImage", "listNetworks", "searchText"],
    },
    execution: { kind: "host" },
    createdDaysAgo: 5,
    updatedDaysAgo: 0,
  },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ModelOverride {
  providerId?: string;
  model: string;
}

// Materialize specs into schema-valid WorkerDefinitions: resolve days-ago into absolute stamps against `now`, and
// optionally override a worker's model by id (the live lens uses this to point each worker at an OpenRouter free
// model). Pure — never mutates the specs.
export function materializeWorkers(
  specs: WorkerSpec[] = CANONICAL_WORKERS,
  opts?: { now?: number; models?: Record<string, ModelOverride> },
): WorkerDefinition[] {
  const now = opts?.now ?? Date.now();
  return specs.map((spec) => {
    const { createdDaysAgo, updatedDaysAgo, ...rest } = spec;
    const override = opts?.models?.[spec.id];
    const worker: WorkerDefinition = {
      ...rest,
      providerId: override?.providerId ?? rest.providerId,
      model: override?.model ?? rest.model,
      createdAt: now - createdDaysAgo * MS_PER_DAY,
      updatedAt: now - updatedDaysAgo * MS_PER_DAY,
    };
    return worker;
  });
}

// OpenRouter free models for the live (multi-inference) lens — DIFFERENT families per worker to prove OMA routes
// per-agent models through our adapter. VERIFY these ids on openrouter.ai/api/v1/models (filter :free) before a
// run: the free roster shifts weekly. Verified 2026-07-21 — all four return real tool_calls for a constrained
// prompt (nemotron/gpt-oss/cohere); the earlier qwen3-235b, llama-3.3-70b and every gemma-4 :free had dropped off
// or errored. The fallback (openrouter/free auto-router) lives in the live test's retry path, not here.
export const OPENROUTER_FREE_MODELS: Record<string, ModelOverride> = {
  "mock-worker-inspector": { providerId: "openrouter", model: "nvidia/nemotron-nano-9b-v2:free" },
  "mock-worker-editor": { providerId: "openrouter", model: "openai/gpt-oss-20b:free" },
  "mock-worker-operator": { providerId: "openrouter", model: "cohere/north-mini-code:free" },
  "mock-worker-reviewer": { providerId: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
};

// The roster as the live lens uses it: every worker on OpenRouter, spread across free model families.
export function workersForLive(opts?: { now?: number; models?: Record<string, ModelOverride> }): WorkerDefinition[] {
  return materializeWorkers(CANONICAL_WORKERS, { now: opts?.now, models: opts?.models ?? OPENROUTER_FREE_MODELS });
}
