import { pathTo } from "../../Navigator";

export const getSecretUrl = (id: string, view: string) => {
  return pathTo(`/screens/secrets/${id}/${view}`);
};
