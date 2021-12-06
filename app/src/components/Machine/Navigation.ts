import { pathTo } from "../../Navigator";

export const getMachineUrl = (id: string, view: string) => {
  return pathTo(`/screens/machines/${id}/${view}`);
};
