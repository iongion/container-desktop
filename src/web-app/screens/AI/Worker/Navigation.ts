import { pathTo } from "@/web-app/Navigator";

export const getWorkersUrl = () => pathTo("/screens/ai/workers");

export const goToWorkers = () => {
  window.location.href = getWorkersUrl();
};
