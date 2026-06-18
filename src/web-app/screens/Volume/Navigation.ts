import { pathTo } from "@/web-app/Navigator";

export const getVolumeUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/volumes/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};
