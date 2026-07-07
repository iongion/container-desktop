import { pathTo } from "@/web-app/Navigator";

// The Troubleshoot family shares one section tab bar. The parent "actions" view keeps the canonical
// `/screens/troubleshoot` path; every other view is a `/screens/troubleshoot/<view>` sub-screen.
export const getTroubleshootUrl = (view: "actions" | "compatibility") => {
  return pathTo(view === "actions" ? "/screens/troubleshoot" : `/screens/troubleshoot/${encodeURIComponent(view)}`);
};
