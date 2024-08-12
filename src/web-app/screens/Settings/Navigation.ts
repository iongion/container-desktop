import { pathTo } from "../../Navigator";

export const getSettingsUrl = (view: string) => {
  return pathTo(`/screens/settings/${encodeURIComponent(view)}`);
};
