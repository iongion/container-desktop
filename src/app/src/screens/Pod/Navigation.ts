import { pathTo } from "../../Navigator";

export const getPodUrl = (id: string, view: string) => {
  return pathTo(`/screens/pod/${encodeURIComponent(id)}/${encodeURIComponent(view)}`);
};
