import { pathTo } from "@/web-app/Navigator";

export const getConnectionsUrl = (view: string) => {
  return pathTo(`/screens/connections/${encodeURIComponent(view)}`);
};
