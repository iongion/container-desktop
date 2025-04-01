import { compile } from "path-to-regexp";

function generatePath(pattern: string, params: Record<string, string | number>) {
  const toPath = compile(pattern);
  return toPath(params as any);
}

export function pathTo<S extends string>(path: S, params?: any): string {
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
