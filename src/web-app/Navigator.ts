import type { ExtractRouteParams } from "react-router";
import { generatePath } from "react-router-dom";

export function pathTo<S extends string>(
  path: S,
  params?: ExtractRouteParams<S, string | number | boolean> | undefined,
): string {
  let clean = generatePath(path, params);
  if (window.location.protocol === "file:") {
    clean = `file://${window.location.pathname}#${clean}`;
  } else {
    clean = `${window.location.origin}/#${clean}`;
  }
  return clean;
}

export const goToScreen = (id: string) => {
  window.location.href = pathTo(id);
};
