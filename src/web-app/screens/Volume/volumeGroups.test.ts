import { describe, expect, it } from "vitest";

import type { Volume } from "@/container-client/types/volume";
import type { MergedResource } from "@/web-app/hooks/useMergedResources";

import { groupVolumesByConnection } from "./volumeGroups";

type MergedVolume = MergedResource<Volume>;

function volume(partial: {
  name: string;
  connectionId: string;
  connectionName?: string;
  engine?: string;
  driver?: string;
}): MergedVolume {
  return {
    Name: partial.name,
    Driver: partial.driver ?? "local",
    CreatedAt: "2024-01-01T00:00:00.000Z",
    Scope: "local",
    Mountpoint: `/var/lib/containers/storage/volumes/${partial.name}/_data`,
    engine: partial.engine ?? "podman",
    connectionId: partial.connectionId,
    connectionName: partial.connectionName ?? partial.connectionId,
  } as unknown as MergedVolume;
}

describe("groupVolumesByConnection", () => {
  it("groups volumes by connection and sorts connection groups by name", () => {
    const groups = groupVolumesByConnection(
      [
        volume({ name: "cache", connectionId: "z", connectionName: "Zulu" }),
        volume({ name: "data", connectionId: "a", connectionName: "Alpha", engine: "docker" }),
      ],
      (a, b) => a.Name.localeCompare(b.Name),
    );

    expect(groups.map((group) => group.key)).toEqual(["a", "z"]);
    expect(groups[0].connection).toMatchObject({ id: "a", name: "Alpha", engine: "docker" });
  });

  it("sorts rows inside each connection without merging same names across connections", () => {
    const groups = groupVolumesByConnection(
      [
        volume({ name: "zeta", connectionId: "podman", connectionName: "System Podman" }),
        volume({ name: "alpha", connectionId: "podman", connectionName: "System Podman" }),
        volume({ name: "alpha", connectionId: "docker", connectionName: "System Docker", engine: "docker" }),
      ],
      (a, b) => a.Name.localeCompare(b.Name),
    );

    expect(groups.find((group) => group.key === "podman")?.items.map((row) => row.Name)).toEqual(["alpha", "zeta"]);
    expect(groups.find((group) => group.key === "docker")?.items.map((row) => row.Name)).toEqual(["alpha"]);
  });
});
