import { pathTo } from "../../Navigator";

export const getImageUrl = (id: string, view: string) => {
  return pathTo(`/screens/image/${id}/${view}`);
};
