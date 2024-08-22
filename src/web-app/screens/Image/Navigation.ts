import { pathTo } from "@/web-app/Navigator";

export const getImageUrl = (id: string, view: string) => {
  return pathTo(`/screens/image/${encodeURIComponent(id)}/${encodeURIComponent(view)}`);
};
