import { describe, expect, it } from "vitest";
import type { EngineDataService } from "@/platform/engineDataService";
import { createEngineOpsAdapter } from "@/platform/engineOpsAdapter";

function serviceWith(currentId: string | undefined, runningIds: string[]): EngineDataService {
  const connections = [
    { id: "podman", name: "System Podman", engine: "podman" },
    { id: "docker", name: "System Docker", engine: "docker" },
  ];
  return {
    getAppRuntimeSnapshot: () => ({ connections, currentConnector: currentId ? { id: currentId } : undefined }),
    getHost: (id: string) => (runningIds.includes(id) ? {} : undefined),
  } as unknown as EngineDataService;
}

describe("createEngineOpsAdapter listConnections", () => {
  // A call without a connectionId goes to the connection selected in the app, which need not be the first one.
  it("marks the connection that calls without a connectionId go to", () => {
    const ops = createEngineOpsAdapter(serviceWith("docker", ["podman", "docker"]));
    expect(ops.listConnections()).toEqual([
      { id: "podman", name: "System Podman", engine: "podman", running: true, current: false },
      { id: "docker", name: "System Docker", engine: "docker", running: true, current: true },
    ]);
  });

  it("marks none current when no connection is selected", () => {
    const ops = createEngineOpsAdapter(serviceWith(undefined, []));
    expect(ops.listConnections().map((connection) => connection.current)).toEqual([false, false]);
  });
});
