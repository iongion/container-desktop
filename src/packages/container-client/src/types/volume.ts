export interface Volume {
  Anonymous: boolean;
  CreatedAt: string;
  GID: number;
  UID: number;
  Driver: string;
  Labels: { [key: string]: string };
  Mountpoint: string;
  Name: string;
  Options: { [key: string]: string };
  Scope: string;
  Status: { [key: string]: string };
  // Present only when the engine's volume list is queried with sizes (Docker `?size=true` → UsageData). Podman's
  // libpod list omits it, so it stays undefined there.
  UsageData?: { Size: number; RefCount: number };
}
