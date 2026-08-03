import {
  CostRegistry,
  estimateFromPriceTable,
  type ProviderCostEstimator,
  type StaticPriceTable,
} from "@/ai-system/core/cost";

const GPT_4O_MINI = { inputPerMillion: 0.15, outputPerMillion: 0.6, currency: "USD" } as const;
const CLAUDE_3_5_HAIKU = { inputPerMillion: 0.8, outputPerMillion: 4, currency: "USD" } as const;
const OPENROUTER_FREE = { inputPerMillion: 0, outputPerMillion: 0, currency: "USD" } as const;

// Exact IDs only: aliases and unknown models remain unpriced until this application-owned table is reviewed.
const staticPriceTable = {
  anthropic: { "claude-3-5-haiku-20241022": CLAUDE_3_5_HAIKU },
  openai: {
    "gpt-4o-mini": GPT_4O_MINI,
    "gpt-4o-mini-2024-07-18": GPT_4O_MINI,
  },
  openrouter: {
    "openai/gpt-4o-mini": GPT_4O_MINI,
    "nvidia/nemotron-nano-9b-v2:free": OPENROUTER_FREE,
    "openai/gpt-oss-20b:free": OPENROUTER_FREE,
    "cohere/north-mini-code:free": OPENROUTER_FREE,
    "nvidia/nemotron-3-super-120b-a12b:free": OPENROUTER_FREE,
  },
} as const satisfies Readonly<Record<string, StaticPriceTable>>;

const estimateAnthropicCost: ProviderCostEstimator = (usage, context) =>
  estimateFromPriceTable(staticPriceTable.anthropic, usage, context);

const estimateLocalCost: ProviderCostEstimator = () => ({ amount: 0, currency: "USD" });

const estimateOpenAICompatibleCost: ProviderCostEstimator = (usage, context) =>
  estimateFromPriceTable(staticPriceTable.openai, usage, context);

const estimateOpenRouterCost: ProviderCostEstimator = (usage, context) =>
  estimateFromPriceTable(staticPriceTable.openrouter, usage, context);

export const defaultCostRegistry = new CostRegistry({
  anthropic: estimateAnthropicCost,
  lmstudio: estimateLocalCost,
  llamacpp: estimateLocalCost,
  ollama: estimateLocalCost,
  openai: estimateOpenAICompatibleCost,
  openrouter: estimateOpenRouterCost,
});
