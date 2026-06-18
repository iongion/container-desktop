import { pathTo } from "@/web-app/Navigator";

export const getImageUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/image/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};
