// web-app/domain/queries.ts — app-level (non-resource) queries. `OnlineApi` is EP-independent; kept as a
// tiny module singleton behind a static useLatestVersion hook (plan §C). NOTE: the Phase 5 cutover that
// deletes the ContainerClient monolith must preserve OnlineApi (it still lives in Api.clients.ts today).

import { useQuery } from "@tanstack/react-query";

import { OnlineApi } from "@/container-client/Api.clients";
import type { OperatingSystem } from "@/env/Types";

const onlineApi = new OnlineApi(import.meta.env.ONLINE_API);

export const versionKeys = {
  latest: (osType: string) => ["version", osType] as const,
};

export const useLatestVersion = (osType?: OperatingSystem) =>
  useQuery({
    queryKey: versionKeys.latest(osType ?? ""),
    queryFn: () => onlineApi.checkLatestVersion(osType!),
    enabled: !!osType,
  });
