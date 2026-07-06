// Renderer-facing compose adapter — the two write operations behind "Import stack" (up) and the
// compose-group teardown (down). Listing/status/start/stop are intentionally absent: a stack is just a
// compose-labelled container group, so the merged container store already provides the list and per-service
// state, and group start/stop is the existing per-group bulk action on the Containers screen. Thin,
// host-bound face over the pure orchestrate/compose-rest helpers; the only thing added here is host-bound
// guest-path resolution, injected into the shared orchestration.

import { composeUp } from "@/container-client/compose/orchestrate";
import type {
  ComposeChangeSummary,
  ComposeDownOptions,
  ComposeProjectModel,
  ComposeUpOptions,
} from "@/container-client/compose/types";
import { down } from "./compose-rest";
import { ResourceAdapter } from "./shared";

export class ComposeAdapter extends ResourceAdapter {
  async up(model: ComposeProjectModel, opts: ComposeUpOptions = {}): Promise<ComposeChangeSummary> {
    const settings = await this.host.getSettings().catch(() => undefined);
    const scope = settings?.controller?.scope ?? "";
    const resolvePath = (localPath: string) => this.host.resolveGuestPath(localPath, scope, settings);
    return composeUp(await this.driver(), model, opts, { resolvePath });
  }

  async down(project: string, opts: ComposeDownOptions = {}): Promise<void> {
    return down(await this.driver(), project, opts);
  }
}
