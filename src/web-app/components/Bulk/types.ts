// components/Bulk/types.ts — shared contracts for the bulk (mass) operations toolkit.
// A BulkAction operates on the resolved item (not a bare id) so each screen can map to whatever
// identifier its adapter expects (Container.Id, Volume.Name, Network.name, Secret.ID, …).

import type { Intent } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";

export interface BulkAction<T> {
  key: string;
  label: string;
  icon: IconName;
  intent?: Intent;
  // Destructive actions (remove) confirm via an Alert before running.
  destructive?: boolean;
  // Mirrors the per-row ActionsMenu enable/disable guard for this item.
  eligible: (item: T) => boolean;
  // Calls the same adapter/host method the single-row mutation uses; resolves true on success.
  run: (item: T) => Promise<boolean>;
}

export interface BulkRunSummary<T> {
  ok: T[];
  failed: { item: T; error: unknown }[];
}
