// Registries & Trust — mutation hooks. Each resolves the row's OWNING connection host (the workspace is merged,
// so an action must target the right engine) and runs the real config/CLI action, then invalidates the grouped
// query so the table reflects the new state. The credential for login is piped to the engine over stdin
// (`--password-stdin`) inside Application.registryLogin — it never reaches argv, logs, or this layer's state.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Application } from "@/container-client/Application";
import { RegistryTrustAdapter } from "@/container-client/adapters/registryTrust";
import type { CommandExecutionResult, RegistryTrustEntry } from "@/env/Types";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { useAppStore } from "@/web-app/stores/appStore";
import { trustKeys } from "./trustQueries";
import type { AddedRegistry } from "./trustStore";

function assertSuccess(result: CommandExecutionResult, fallback: string): CommandExecutionResult {
  if (!result.success) {
    throw new Error(result.stderr?.trim() || fallback);
  }
  return result;
}

export interface RegistryLoginVars {
  connectionId: string;
  registry: string;
  username: string;
  secret: string;
  insecure?: boolean;
}

export function useRegistryLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: RegistryLoginVars) => {
      const host = await resolveConnectionHost(vars.connectionId);
      const result = await new RegistryTrustAdapter(host).login({
        registry: vars.registry,
        username: vars.username,
        secret: vars.secret,
        insecure: vars.insecure,
      });
      return assertSuccess(result, `Could not sign in to ${vars.registry}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trustKeys.all }),
  });
}

export interface RegistryLogoutVars {
  connectionId: string;
  registry: string;
}

export function useRegistryLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: RegistryLogoutVars) => {
      const host = await resolveConnectionHost(vars.connectionId);
      const result = await new RegistryTrustAdapter(host).logout(vars.registry);
      return assertSuccess(result, `Could not sign out of ${vars.registry}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trustKeys.all }),
  });
}

// The connection's app-MANAGED registry set (desired state), read from its persisted settings.registries.
function managedRegistries(connectionId: string): RegistryTrustEntry[] {
  const connection = useAppStore.getState().connections.find((item) => item.id === connectionId);
  return connection?.settings?.registries ?? [];
}

export interface AddRegistryVars {
  connectionId: string;
  registry: AddedRegistry;
}

// Add a registry to the connection's managed set: persist settings.registries (setConnectionRegistries also
// evicts the cached host so later reads are fresh) then project it into the engine's registries.conf /
// daemon.json. Idempotent — a name already present is left untouched.
export function useAddRegistry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: AddRegistryVars) => {
      const current = managedRegistries(vars.connectionId);
      if (current.some((entry) => entry.name === vars.registry.name)) {
        return;
      }
      const next: RegistryTrustEntry[] = [
        ...current,
        {
          name: vars.registry.name,
          tls: vars.registry.tls,
          mirrorOf: vars.registry.mirrorOf,
          order: current.length + 1,
          enabled: true,
        },
      ];
      const app = Application.getInstance();
      await app.setConnectionRegistries({ connectionId: vars.connectionId, registries: next });
      const host = await resolveConnectionHost(vars.connectionId);
      if (host) {
        await app.writeRegistryConfig({ host, registries: next, removedLocations: [] });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trustKeys.all }),
  });
}

export interface RemoveRegistryVars {
  connectionId: string;
  name: string;
}

// Remove a registry from the connection's managed set: drop it from settings.registries then delete ONLY that
// managed location from registries.conf / daemon.json (unmanaged user/system entries are preserved).
export function useRemoveRegistry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: RemoveRegistryVars) => {
      const next = managedRegistries(vars.connectionId).filter((entry) => entry.name !== vars.name);
      const app = Application.getInstance();
      await app.setConnectionRegistries({ connectionId: vars.connectionId, registries: next });
      const host = await resolveConnectionHost(vars.connectionId);
      if (host) {
        await app.writeRegistryConfig({ host, registries: next, removedLocations: [vars.name] });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trustKeys.all }),
  });
}
