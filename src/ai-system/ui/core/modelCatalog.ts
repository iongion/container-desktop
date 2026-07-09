// Pure model-tree builder for the chat composer's ModelPicker. Turns a provider catalog
// entry + the models its server reports into a grouped tree the popover renders:
//   AI inference source → model provider → model
// Flat sources (LM Studio, single clouds) collapse to two levels (source == provider). Aggregators
// (OpenRouter) keep all three because their ids are vendor-prefixed ("anthropic/claude-3.5-sonnet").
// No React/window — uses resolveModelChoice for the saved/auto-select semantics. The component owns the
// fetch; this just shapes the result.

import { getProviderEntry, type ProviderCatalogEntry, parseAggregatedModelId } from "@/ai-system/core";

import { resolveModelChoice } from "./modelChoice";

export interface ModelLeaf {
  // Full model id to persist (e.g. "anthropic/claude-3.5-sonnet" for an aggregator, "qwen2.5" for a flat source).
  model: string;
  // Display text — the model portion after the vendor prefix for aggregators, the full id otherwise.
  label: string;
  selected: boolean;
  // llama.cpp's single served model is informational — the server bound it at launch and can't switch.
  readOnly?: boolean;
}

export interface ProviderGroup {
  // Upstream provider id ("anthropic") for aggregators; the source id for flat sources.
  providerId: string;
  label: string;
  models: ModelLeaf[];
}

export interface SourceModelTree {
  sourceId: string;
  label: string;
  aggregator: boolean;
  // No intermediate provider level (flat source) → the picker renders leaves directly under the source.
  collapsed: boolean;
  groups: ProviderGroup[];
  // Set when nothing was saved (or the single served model drifted) → the caller persists it.
  autoSelect?: string;
  // A non-selectable status row instead of leaves (server down / nothing served).
  notice?: string;
}

export interface BuildModelTreeArgs {
  entry: ProviderCatalogEntry;
  models: string[];
  savedModel: string;
}

// A known upstream provider id maps to its catalog label ("anthropic" → "Anthropic"); otherwise the raw
// segment is shown as-is (e.g. "meta-llama", "google") — honest, no lossy prettifying.
function upstreamLabel(segment: string): string {
  return getProviderEntry(segment)?.label ?? segment;
}

function emptyNotice(entry: ProviderCatalogEntry): string {
  if (entry.discovery === "single") {
    return `${entry.label} is not serving a model — start its server with -m <model>.`;
  }
  return entry.cloud ? "No models available." : `No models found — is ${entry.label} running?`;
}

export function buildModelTree({ entry, models, savedModel }: BuildModelTreeArgs): SourceModelTree {
  const base: Omit<SourceModelTree, "groups"> = {
    sourceId: entry.id,
    label: entry.label,
    aggregator: entry.aggregator,
    collapsed: !entry.aggregator,
  };

  // llama.cpp: exactly one model, bound at launch, unswitchable → a single read-only leaf (or a notice).
  if (entry.discovery === "single") {
    const served = Array.from(new Set(models.filter((m) => typeof m === "string" && m.length > 0)));
    if (served.length === 0) {
      return { ...base, collapsed: true, groups: [], notice: emptyNotice(entry) };
    }
    const model = served[0];
    return {
      ...base,
      collapsed: true,
      groups: [
        { providerId: entry.id, label: entry.label, models: [{ model, label: model, selected: true, readOnly: true }] },
      ],
      // Persist the served id so chat targets what the server actually serves (no-op if already saved).
      autoSelect: savedModel === model ? undefined : model,
    };
  }

  // List sources (LM Studio, clouds, OpenRouter): reuse resolveModelChoice for dedupe + auto-select +
  // keep-saved-selectable. No free-text fallback here — an empty, reachable source shows a notice.
  const choice = resolveModelChoice(savedModel, models);
  if (choice.options.length === 0) {
    return { ...base, groups: [], notice: emptyNotice(entry) };
  }
  const selectedValue = choice.value;

  if (!entry.aggregator) {
    const leaves: ModelLeaf[] = choice.options.map((id) => ({ model: id, label: id, selected: id === selectedValue }));
    return {
      ...base,
      groups: [{ providerId: entry.id, label: entry.label, models: leaves }],
      autoSelect: choice.autoSelect,
    };
  }

  // Aggregator: split each id on its vendor prefix and group by upstream provider, first-seen order.
  const groupByKey = new Map<string, ProviderGroup>();
  const order: string[] = [];
  for (const id of choice.options) {
    const { provider, model } = parseAggregatedModelId(id);
    const key = provider || "other";
    let group = groupByKey.get(key);
    if (!group) {
      group = { providerId: provider || "other", label: provider ? upstreamLabel(provider) : "Other", models: [] };
      groupByKey.set(key, group);
      order.push(key);
    }
    group.models.push({ model: id, label: model || id, selected: id === selectedValue });
  }
  return { ...base, groups: order.map((k) => groupByKey.get(k) as ProviderGroup), autoSelect: choice.autoSelect };
}

// The selected source → provider → model path for the trigger label ("LM Studio / qwen2.5" or
// "OpenRouter / Anthropic / claude-3.5-sonnet"). Derived purely from the catalog + saved id, so it
// renders before any discovery (the popover hasn't fetched yet). Empty model → just the source label.
export function selectedPath(providerId: string, model: string): string[] {
  if (!providerId) {
    return [];
  }
  const entry = getProviderEntry(providerId);
  const sourceLabel = entry?.label ?? providerId;
  if (!model) {
    return [sourceLabel];
  }
  if (entry?.aggregator) {
    const { provider, model: sub } = parseAggregatedModelId(model);
    if (provider) {
      return [sourceLabel, upstreamLabel(provider), sub];
    }
  }
  return [sourceLabel, model];
}
