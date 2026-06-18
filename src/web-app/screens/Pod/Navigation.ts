import { pathTo } from "@/web-app/Navigator";

export const getPodUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/pod/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};
