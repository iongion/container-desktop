// screens/Container/composeQueries.ts — the compose orchestration that backs the "Import stack" drawer and
// the compose-group teardown action, now that stacks live INSIDE the Containers screen (a stack is just a
// compose-labelled container group). Only the two write operations survive the fold: `up` (deploy a compose
// file as native containers) and `down` (tear a project down — containers + networks + pod + volumes).
// Listing/status/start/stop are gone: the merged container store already groups by compose project, and
// group start/stop is the existing per-group bulk action.

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ComposeAdapter } from "@/container-client/adapters/compose";
import type { ComposeProjectModel, ComposeSource, ComposeUpOptions } from "@/container-client/compose/types";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { resourceEvents } from "@/web-app/stores/resourceEvents";

async function composeAdapter(connId: string): Promise<ComposeAdapter> {
  const host = await resolveConnectionHost(connId);
  if (!host) {
    throw new Error("No active engine connection");
  }
  return new ComposeAdapter(host);
}

// A compose op touches several real resource domains — nudge them all on the owning connection so the merged
// Containers list (plus networks/volumes/pods) reflects the change immediately.
async function refreshComposeDomains(connId: string): Promise<void> {
  await resourceEvents.refreshMany(connId, ["containers", "networks", "volumes", "pods"]);
}

// Deploy a parsed compose model as native containers (the Import stack drawer). Fixed target connection.
export const useComposeUp = (connId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      model,
      options,
      source,
    }: {
      model: ComposeProjectModel;
      options?: ComposeUpOptions;
      source?: ComposeSource;
    }) => (await composeAdapter(connId)).up(model, options, source),
    onSuccess: async () => {
      await refreshComposeDomains(connId);
      qc.invalidateQueries({ queryKey: ["containers"] });
    },
  });
};

// Tear a stack down from its group header in the merged Containers list. Imperative (not a hook) because the
// owning connection is only known per-group at click time — it routes to that container group's connection,
// exactly like the per-group bulk actions do.
export async function tearDownStack(connId: string, project: string): Promise<void> {
  await (await composeAdapter(connId)).down(project, {});
  await refreshComposeDomains(connId);
}
