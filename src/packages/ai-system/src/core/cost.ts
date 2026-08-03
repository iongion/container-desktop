export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface CostContext {
  model: string;
}

export type ProviderCostEstimator = (usage: TokenUsage, context: CostContext) => Money | undefined;

export interface StaticTokenPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: string;
}

export type StaticPriceTable = Readonly<Record<string, StaticTokenPrice>>;

export function estimateFromPriceTable(
  table: StaticPriceTable,
  usage: TokenUsage,
  context: CostContext,
): Money | undefined {
  const price = table[context.model];
  if (!price || !validUsage(usage)) return undefined;
  return {
    amount: (usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion) / 1_000_000,
    currency: price.currency,
  };
}

function validUsage(usage: TokenUsage): boolean {
  return (
    Number.isFinite(usage.inputTokens) &&
    usage.inputTokens >= 0 &&
    Number.isFinite(usage.outputTokens) &&
    usage.outputTokens >= 0
  );
}

function validMoney(money: Money | undefined): money is Money {
  return Boolean(money && Number.isFinite(money.amount) && money.amount >= 0 && money.currency.trim());
}

export class CostRegistry {
  readonly #estimators: Readonly<Record<string, ProviderCostEstimator>>;

  constructor(estimators: Readonly<Record<string, ProviderCostEstimator>>) {
    this.#estimators = { ...estimators };
  }

  estimate(provider: string, usage: TokenUsage, context: CostContext): Money | undefined {
    if (!validUsage(usage) || !context.model.trim()) return undefined;
    const estimated = this.#estimators[provider]?.(usage, context);
    return validMoney(estimated) ? estimated : undefined;
  }
}

export interface OmaCostUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface OmaCostContext {
  agentName: string;
  model: string;
  provider?: string;
}

export function makeEstimateCost(
  registry: CostRegistry,
  resolveProvider: (context: OmaCostContext) => string | undefined = (context) => context.provider,
): (usage: OmaCostUsage, context: OmaCostContext) => number {
  return (usage, context) =>
    registry.estimate(
      resolveProvider(context) ?? "",
      { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
      context,
    )?.amount ?? 0;
}
