import { pathTo } from "@/web-app/Navigator";

export const getPodUrl = (id: string, view: string) => {
  return pathTo(`/screens/pod/${encodeURIComponent(id)}/${encodeURIComponent(view)}`);
};
