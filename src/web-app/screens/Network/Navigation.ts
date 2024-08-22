import { pathTo } from "@/web-app/Navigator";

export const getNetworkUrl = (id: string, view: string) => {
  return pathTo(`/screens/network/${encodeURIComponent(id)}/${encodeURIComponent(view)}`);
};
