// Single renderer startup timeline (t0 ≈ navigationStart, imported first thing by index.tsx).
import { createLogger } from "@/logger";
import { createTimeline } from "@/logger/timing";

export const bootTimeline = createTimeline({ label: "startup.renderer" });
export const bootLogger = createLogger("web.boot");

let summarized = false;
export function logBootSummary(): void {
  if (summarized) {
    return;
  }
  summarized = true;
  bootLogger.info(`Renderer READY (${bootTimeline.since()}ms)\n${bootTimeline.summary()}`);
}
