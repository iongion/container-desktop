import { pathTo } from "@/web-app/Navigator";

export const getRegistryUrl = (id: string, view: string) => {
  return pathTo(`/screens/registry/${encodeURIComponent(id)}/${encodeURIComponent(view)}`);
};
