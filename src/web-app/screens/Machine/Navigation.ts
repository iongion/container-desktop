import { pathTo } from "@/web-app/Navigator";

export const getMachineUrl = (id: string, view: string) => {
  return pathTo(`/screens/machines/${encodeURIComponent(id)}/${encodeURIComponent(view)}`);
};
