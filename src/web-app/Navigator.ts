import { useParams } from "@tanstack/react-router";
import { compile } from "path-to-regexp";

/**
 * Typed accessor for the active route's path params. TanStack does not infer param names without route
 * codegen (our `Screen.Route.Path` values are `string`-typed, so `$id` can't be read at the type level),
 * but the matched route does carry them at runtime — callers name the shape they expect.
 */
export function useRouteParams<T extends Record<string, string>>(): T {
  return useParams({ strict: false }) as unknown as T;
}

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
