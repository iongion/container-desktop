import { pathTo } from "@/web-app/Navigator";

export const getVolumeUrl = (id: string, view: string) => {
  return pathTo(`/screens/volumes/${encodeURIComponent(id)}/${encodeURIComponent(view)}`);
};
