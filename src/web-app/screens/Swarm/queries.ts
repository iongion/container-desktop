// screens/Swarm/queries.ts — TanStack Query layer for Docker Swarm, over the SwarmAdapter.
//
// Swarm is Docker-only and NOT in the main-process snapshot pipeline (low-churn, manager-only), so these
// poll via liveQueryOptions() and have NO live /events push — refresh is interval + mount + manual +
// mutation-invalidation. Every hook is host-scoped: resolveSwarmHost throws when the connection is
// missing so an empty connId can NEVER fall back to the global active host (which could be Podman).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { SwarmAdapter } from "@/container-client/adapters/swarm";
import type {
  NodeUpdateOptions,
  SwarmConfigCreateOptions,
  SwarmInitOptions,
  SwarmLeaveOptions,
  SwarmSecretCreateOptions,
} from "@/env/Types";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { liveQueryOptions } from "@/web-app/domain/queryClient";

export type SwarmInspectKind = "service" | "node" | "config" | "secret";

export const swarmKeys = {
  all: ["swarm"] as const,
  info: (connId: string) => [...swarmKeys.all, "info", connId] as const,
  services: (connId: string) => [...swarmKeys.all, "services", connId] as const,
  nodes: (connId: string) => [...swarmKeys.all, "nodes", connId] as const,
  stacks: (connId: string) => [...swarmKeys.all, "stacks", connId] as const,
  tasks: (connId: string, serviceId?: string) => [...swarmKeys.all, "tasks", connId, serviceId ?? ""] as const,
  secrets: (connId: string) => [...swarmKeys.all, "secrets", connId] as const,
  configs: (connId: string) => [...swarmKeys.all, "configs", connId] as const,
  inspect: (connId: string, kind: SwarmInspectKind, id: string) =>
    [...swarmKeys.all, "inspect", kind, connId, id] as const,
};

async function resolveSwarmHost(connId: string) {
  const host = await resolveConnectionHost(connId);
  if (!host) {
    throw new Error("No active engine connection");
  }
  return host;
}

async function swarmAdapter(connId: string): Promise<SwarmAdapter> {
  return new SwarmAdapter(await resolveSwarmHost(connId));
}

// A 5xx from a swarm endpoint is DEFINITIVE, not transient: Docker answers 503 "this node is not a swarm
// manager" when the engine is not in a swarm, and other 5xx mean the daemon is unhealthy — retrying on the
// spot just amplifies the failure (this, plus the screen's polling, is what produced the endless 503 toast
// storm). So swarm reads never retry a 5xx (nor the usual auth/not-found); genuinely transient errors (a
// network blip with no HTTP status) still get the default couple of retries. Status is coerced because it can
// arrive as a string after the renderer→main IPC proxy re-serialises the error.
export function swarmRetry(count: number, error: any): boolean {
  const status = Number(error?.response?.status ?? error?.status);
  if (status >= 500 || status === 401 || status === 403 || status === 404) {
    return false;
  }
  return count < 2;
}

// Live-list options for swarm resources that genuinely change while you watch them (services/nodes/tasks/…):
// poll like the other live screens, but with the swarm retry policy above.
const swarmListOptions = () => ({ ...liveQueryOptions(), retry: swarmRetry });

export const useSwarmInfo = (connId: string, enabled = true) =>
  useQuery({
    queryKey: swarmKeys.info(connId),
    // TanStack forbids `undefined` as query data — a non-swarm daemon yields undefined, so map to null.
    queryFn: async () => (await (await swarmAdapter(connId)).inspect()) ?? null,
    enabled: enabled && !!connId,
    // Cache-first PROBE — deliberately NOT polled. On an engine that is not in a swarm this is the query that
    // would otherwise re-hit /swarm every couple of seconds forever; swarm membership is low-churn, so refresh
    // on mount, on manual reload and after init/leave (invalidation) instead. The live lists below still poll
    // while a swarm IS active. retry: swarmRetry so a not-in-a-swarm 503 never triggers on-the-spot retries.
    refetchOnMount: true,
    refetchOnReconnect: true,
    retry: swarmRetry,
  });

export const useSwarmServices = (connId: string, enabled = true) =>
  useQuery({
    queryKey: swarmKeys.services(connId),
    queryFn: async () => (await swarmAdapter(connId)).listServices(),
    enabled: enabled && !!connId,
    ...swarmListOptions(),
  });

export const useSwarmNodes = (connId: string, enabled = true) =>
  useQuery({
    queryKey: swarmKeys.nodes(connId),
    queryFn: async () => (await swarmAdapter(connId)).listNodes(),
    enabled: enabled && !!connId,
    ...swarmListOptions(),
  });

export const useSwarmStacks = (connId: string, enabled = true) =>
  useQuery({
    queryKey: swarmKeys.stacks(connId),
    queryFn: async () => (await swarmAdapter(connId)).listStacks(),
    enabled: enabled && !!connId,
    ...swarmListOptions(),
  });

export const useSwarmTasks = (connId: string, serviceId?: string, enabled = true) =>
  useQuery({
    queryKey: swarmKeys.tasks(connId, serviceId),
    queryFn: async () => (await swarmAdapter(connId)).listTasks(serviceId),
    enabled: enabled && !!connId,
    ...swarmListOptions(),
  });

export const useSwarmSecrets = (connId: string, enabled = true) =>
  useQuery({
    queryKey: swarmKeys.secrets(connId),
    queryFn: async () => (await swarmAdapter(connId)).listSecrets(),
    enabled: enabled && !!connId,
    ...swarmListOptions(),
  });

export const useSwarmConfigs = (connId: string, enabled = true) =>
  useQuery({
    queryKey: swarmKeys.configs(connId),
    queryFn: async () => (await swarmAdapter(connId)).listConfigs(),
    enabled: enabled && !!connId,
    ...swarmListOptions(),
  });

export const useSwarmInspect = (connId: string, kind: SwarmInspectKind, id?: string) =>
  useQuery({
    queryKey: swarmKeys.inspect(connId, kind, id ?? ""),
    queryFn: async () => {
      const adapter = await swarmAdapter(connId);
      // TanStack forbids `undefined` as query data — a not-found entity yields undefined, so map to null.
      switch (kind) {
        case "service":
          return (await adapter.getService(id!)) ?? null;
        case "node":
          return (await adapter.getNode(id!)) ?? null;
        case "config":
          return (await adapter.getConfig(id!)) ?? null;
        default:
          return (await adapter.getSecret(id!)) ?? null;
      }
    },
    enabled: !!connId && !!id,
    ...swarmListOptions(),
  });

function useSwarmInvalidator() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: swarmKeys.all });
}

export const useSwarmInit = (connId: string) => {
  const invalidate = useSwarmInvalidator();
  return useMutation({
    mutationFn: async (opts?: SwarmInitOptions) => (await swarmAdapter(connId)).init(opts),
    onSuccess: invalidate,
  });
};

export const useSwarmLeave = (connId: string) => {
  const invalidate = useSwarmInvalidator();
  return useMutation({
    mutationFn: async (opts?: SwarmLeaveOptions) => (await swarmAdapter(connId)).leave(opts),
    onSuccess: invalidate,
  });
};

export const useScaleService = (connId: string) => {
  const invalidate = useSwarmInvalidator();
  return useMutation({
    mutationFn: async ({ id, replicas }: { id: string; replicas: number }) =>
      (await swarmAdapter(connId)).scaleService(id, replicas),
    onSuccess: invalidate,
  });
};

export const useRemoveService = (connId: string) => {
  const invalidate = useSwarmInvalidator();
  return useMutation({
    mutationFn: async (id: string) => (await swarmAdapter(connId)).removeService(id),
    onSuccess: invalidate,
  });
};

export const useUpdateNode = (connId: string) => {
  const invalidate = useSwarmInvalidator();
  return useMutation({
    mutationFn: async ({ id, opts }: { id: string; opts: NodeUpdateOptions }) =>
      (await swarmAdapter(connId)).updateNode(id, opts),
    onSuccess: invalidate,
  });
};

export const useRemoveNode = (connId: string) => {
  const invalidate = useSwarmInvalidator();
  return useMutation({
    mutationFn: async (id: string) => (await swarmAdapter(connId)).removeNode(id, true),
    onSuccess: invalidate,
  });
};

export const useCreateSwarmSecret = (connId: string) => {
  const invalidate = useSwarmInvalidator();
  return useMutation({
    mutationFn: async (opts: SwarmSecretCreateOptions) => (await swarmAdapter(connId)).createSecret(opts),
    onSuccess: invalidate,
  });
};

export const useRemoveSwarmSecret = (connId: string) => {
  const invalidate = useSwarmInvalidator();
  return useMutation({
    mutationFn: async (id: string) => (await swarmAdapter(connId)).removeSecret(id),
    onSuccess: invalidate,
  });
};

export const useCreateSwarmConfig = (connId: string) => {
  const invalidate = useSwarmInvalidator();
  return useMutation({
    mutationFn: async (opts: SwarmConfigCreateOptions) => (await swarmAdapter(connId)).createConfig(opts),
    onSuccess: invalidate,
  });
};

export const useRemoveSwarmConfig = (connId: string) => {
  const invalidate = useSwarmInvalidator();
  return useMutation({
    mutationFn: async (id: string) => (await swarmAdapter(connId)).removeConfig(id),
    onSuccess: invalidate,
  });
};
