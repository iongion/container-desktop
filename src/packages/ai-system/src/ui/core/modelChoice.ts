// Smart model-picker logic for the chat composer. Given the provider's currently-saved
// model and the models the provider's server actually reports (via window.AI.listModels), decide what
// the model control should show: a dropdown of real models when the server lists any (pre-selecting a
// sensible default when none is saved yet), or a free-text input when nothing is reachable. Pure +
// unit-tested; the component owns the fetch.

export interface ModelChoice {
  mode: "select" | "input";
  value: string;
  options: string[];
  // Set when no model was saved and we defaulted to the first listed model — the caller persists it.
  autoSelect?: string;
}

export function resolveModelChoice(currentModel: string, listed: string[]): ModelChoice {
  const models = Array.from(new Set((listed ?? []).filter((m) => typeof m === "string" && m.length > 0)));
  const current = (currentModel ?? "").trim();

  if (models.length === 0) {
    // Nothing reachable (keyless cloud / server down): let the user type a model id.
    return { mode: "input", value: current, options: [] };
  }
  if (!current) {
    // Smart default: a reachable server with models and none chosen yet → pick the first.
    return { mode: "select", value: models[0], options: models, autoSelect: models[0] };
  }
  // Keep the saved model selectable even if the server didn't list it.
  const options = models.includes(current) ? models : [...models, current];
  return { mode: "select", value: current, options };
}
