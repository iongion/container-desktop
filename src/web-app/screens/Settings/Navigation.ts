import { pathTo } from "@/web-app/Navigator";

export const getSettingsUrl = (view: string) => {
  return pathTo(`/screens/settings/${encodeURIComponent(view)}`);
};
