import { pathTo } from "@/web-app/Navigator";

// get*Url return FULLY-RESOLVED hrefs (pathTo already applied) for href props. Do NOT pass them to goToScreen —
// it calls pathTo again, and the double-prefixed result silently fails to navigate. Use the go* helpers instead.
export const getRunsUrl = () => pathTo("/screens/ai/runs");

export const getRunUrl = (runId: string) => pathTo(`/screens/ai/run/${encodeURIComponent(runId)}`);

export const goToRuns = () => {
  window.location.href = getRunsUrl();
};

export const goToRun = (runId: string) => {
  window.location.href = getRunUrl(runId);
};
