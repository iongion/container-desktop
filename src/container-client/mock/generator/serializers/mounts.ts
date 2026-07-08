// LogicalMount → the raw mount OBJECT a real engine returns in BOTH its container list and inspect payloads
// (Docker `/containers/json` + Podman docker-compat): Type, Source/Name, Destination, Mode, RW, Driver,
// Propagation. Shared by the docker + podman serializers so list and inspect agree. Pure.

import type { LogicalMount } from "../model";

export interface SerializedMount {
  Type: string;
  Name?: string;
  Source: string;
  Destination: string;
  Driver?: string;
  Mode: string;
  RW: boolean;
  Propagation: string;
}

export function serializeMounts(mounts: LogicalMount[], volumeRoot: string): SerializedMount[] {
  return mounts.map((mount) => {
    const rw = !mount.readOnly;
    if (mount.type === "bind") {
      return {
        Type: "bind",
        Source: mount.source ?? "",
        Destination: mount.destination,
        Mode: rw ? "rw" : "ro",
        RW: rw,
        Propagation: "rprivate",
      };
    }
    return {
      Type: "volume",
      Name: mount.volumeName ?? "",
      Source: `${volumeRoot}/${mount.volumeName}/_data`,
      Destination: mount.destination,
      Driver: "local",
      Mode: rw ? "rw" : "ro",
      RW: rw,
      Propagation: "",
    };
  });
}
