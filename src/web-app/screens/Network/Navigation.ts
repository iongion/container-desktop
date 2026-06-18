import { pathTo } from "@/web-app/Navigator";

export const getNetworkUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/network/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};
