import type { CommandExecutionResult } from "@/host-contract/exec";
// Pure libpod REST logic for pod logs. libpod exposes NO pod-logs REST endpoint, so this fans out to each
// member container's /containers/{id}/logs (the very endpoint the Containers screen already uses), demuxes
// the Docker multiplexed stream with the shared decoder, and merges them — every line prefixed with its
// container so a pod's output reads like `podman pod logs`, but entirely over the socket. This makes pod
// logs work on API/socket connections with no local CLI (`program.path`), which is why it is the DEFAULT.
// Imports only ./baseUrls + the pure log decoder + types, exactly like compose-rest/swarm-rest.

import type { AxiosInstance } from "axios";

import { decodeContainerLogPayload } from "@/container-client/logs";

import { LIBPOD_BASE_URL } from "./baseUrls";

type Raw = Record<string, any>;

const nameOf = (container: Raw): string =>
  String(container?.Name ?? container?.Names?.[0] ?? container?.Id ?? "").replace(/^\//, "");

// Aggregate a pod's member-container logs over REST (no CLI). Infra container excluded; lines are prefixed.
export async function getPodLogsViaRest(
  driver: AxiosInstance,
  podId: string,
  tail?: number,
): Promise<CommandExecutionResult> {
  const inspect = await driver.get(`/pods/${encodeURIComponent(podId)}/json`, { baseURL: LIBPOD_BASE_URL });
  const data: Raw = inspect.data ?? {};
  const infraId = data.InfraContainerID ?? data.InfraID;
  const members: Raw[] = (Array.isArray(data.Containers) ? data.Containers : []).filter(
    (container) => container?.Id && container.Id !== infraId,
  );

  const sections: string[] = [];
  for (const member of members) {
    const name = nameOf(member);
    try {
      const result = await driver.get(`/containers/${encodeURIComponent(member.Id)}/logs`, {
        baseURL: LIBPOD_BASE_URL,
        params: { stdout: true, stderr: true, tail: tail ?? 100, timestamps: false },
        headers: { Accept: "application/octet-stream" },
        responseType: "arraybuffer",
      });
      const text = decodeContainerLogPayload(result.data).replace(/\s+$/, "");
      const body = text
        ? text
            .split("\n")
            .map((line) => `${name} | ${line}`)
            .join("\n")
        : `${name} | <no logs>`;
      sections.push(body);
    } catch {
      sections.push(`${name} | <logs unavailable>`);
    }
  }

  return { pid: 0, code: 0, success: true, stdout: sections.join("\n"), stderr: "", command: `pod logs ${podId}` };
}
