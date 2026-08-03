import { pathTo } from "@/web-app/Navigator";

// The AI family's sections, for the navbar tab navigator: the Assistant, the containerized Coding Agent and
// its Plugins. All three are ExcludeFromSidebar and reached through the header AI menu, so this bar is how
// they cross-link.
export const getAIScreenUrl = (view: "assistant" | "coding-agent" | "plugins") => {
  return pathTo(`/screens/ai/${view}`);
};
