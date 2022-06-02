import { pathTo } from "../../Navigator";

export const getRegistryUrl = (id: string, view: string) => {
  return pathTo(`/screens/registry/${encodeURIComponent(id)}/${encodeURIComponent(view)}`);
};
