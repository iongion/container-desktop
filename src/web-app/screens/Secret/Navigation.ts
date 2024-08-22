import { pathTo } from "@/web-app/Navigator";

export const getSecretUrl = (id: string, view: string) => {
  return pathTo(`/screens/secrets/${encodeURIComponent(id)}/${encodeURIComponent(view)}`);
};
