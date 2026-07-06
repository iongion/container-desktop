// Single main-process startup timeline (t0 ≈ process start, since this module is imported at the top of
// main.ts). Lives in its own module so main.ts and windowManager.ts share ONE instance without threading
// callbacks. The renderer has its own singleton (web-app/bootTimeline.ts).
import { createTimeline } from "@/platform/logger/timing";

export const mainStartup = createTimeline({ label: "startup.main" });
