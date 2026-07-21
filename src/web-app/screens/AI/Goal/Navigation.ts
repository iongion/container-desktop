import { pathTo } from "@/web-app/Navigator";

// get*Url return FULLY-RESOLVED hrefs (pathTo already applied) for href props. Do NOT pass them to goToScreen —
// it calls pathTo again, and the double-prefixed result silently fails to navigate. Use the go* helpers instead.
export const getGoalsUrl = () => pathTo("/screens/ai/goals");

export const getGoalRunUrl = (runId: string) => pathTo(`/screens/ai/goal/${encodeURIComponent(runId)}`);

export const goToGoals = () => {
  window.location.href = getGoalsUrl();
};

export const goToGoalRun = (runId: string) => {
  window.location.href = getGoalRunUrl(runId);
};
