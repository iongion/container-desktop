// Resolve the renderer-side host facade for a specific connection, so a per-resource adapter built with it
// (`new XAdapter(host)`) forwards its requests to THAT engine. In the always-merged workspace a list mixes
// rows from several connections, so every action must target the row's owning connection rather than the
// singular "active" host the adapter base defaults to.
//
// The command proxy (and the mock) route by the connection the host carries; Application.getConnectionApi
// builds the host bound to that connection and caches it in Application.connectionApis, so repeat calls are
// cheap. An unknown id returns undefined — adapter constructors then fall back to the active/primary host
// (single-connection back-compat), so callers can pass the result straight through.

import { Application } from "@/container-client/Application";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { useAppStore } from "@/web-app/stores/appStore";

export async function resolveConnectionHost(connectionId?: string): Promise<HostClientFacade | undefined> {
  if (!connectionId) {
    return undefined;
  }
  const app = Application.getInstance();
  const existing = app.getHostClientFor(connectionId);
  if (existing) {
    return existing;
  }
  const connection = useAppStore.getState().connections.find((item) => item.id === connectionId);
  if (!connection) {
    return undefined;
  }
  return app.getConnectionApi(connection, true);
}
