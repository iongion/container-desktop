// Pure model-tree builder for the chat composer's ModelPicker. Turns a provider catalog
// entry + the models its server reports into a grouped tree the popover renders:
//   AI inference source → model provider → model
// Flat sources (LM Studio, single clouds) collapse to two levels (source == provider). Aggregators
// (OpenRouter) keep all three because their ids are vendor-prefixed ("anthropic/claude-3.5-sonnet").
// No React/window — uses resolveModelChoice for the saved/auto-select semantics. The component owns the
// fetch; this just shapes the result.

import { getProviderEntry, type ProviderCatalogEntry, parseAggregatedModelId } from "@/ai-system/core/providers";

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

// A semantic "why there are no leaves" marker. Core stays i18n-free: the UI resolves this to prose via `t()`
// (see ModelNavigator), passing `nameLabelKey` through `t()` for the provider label.
export type SourceModelNotice =
  | { kind: "server-idle"; nameLabelKey: string }
  | { kind: "no-models-cloud" }
  | { kind: "no-models-local"; nameLabelKey: string };

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
  notice?: SourceModelNotice;
}

export interface BuildModelTreeArgs {
  entry: ProviderCatalogEntry;
  models: string[];
  savedModel: string;
}

// A known upstream provider id maps to its catalog label ("anthropic" → "Anthropic"); otherwise the raw
// segment is shown as-is (e.g. "meta-llama", "google") — honest, no lossy prettifying.
function upstreamLabel(segment: string): string {
  return getProviderEntry(segment)?.labelKey ?? segment;
}

function emptyNotice(entry: ProviderCatalogEntry): SourceModelNotice {
  if (entry.discovery === "single") {
    return { kind: "server-idle", nameLabelKey: entry.labelKey };
  }
  return entry.cloud ? { kind: "no-models-cloud" } : { kind: "no-models-local", nameLabelKey: entry.labelKey };
}

export function buildModelTree({ entry, models, savedModel }: BuildModelTreeArgs): SourceModelTree {
  const base: Omit<SourceModelTree, "groups"> = {
    sourceId: entry.id,
    label: entry.labelKey,
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
        {
          providerId: entry.id,
          label: entry.labelKey,
          models: [{ model, label: model, selected: true, readOnly: true }],
        },
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
      groups: [{ providerId: entry.id, label: entry.labelKey, models: leaves }],
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
  const sourceLabel = entry?.labelKey ?? providerId;
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

export function formatSelectedPath(path: string[], hasModel: boolean, translate: (value: string) => string): string {
  return path.map((part, index) => (hasModel && index === path.length - 1 ? part : translate(part))).join(" / ");
}
