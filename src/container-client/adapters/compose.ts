// Renderer-facing compose adapter — the two write operations behind "Import stack" (up) and the
// compose-group teardown (down). Listing/status/start/stop are intentionally absent: a stack is just a
// compose-labelled container group, so the merged container store already provides the list and per-service
// state, and group start/stop is the existing per-group bulk action on the Containers screen.
//
// Engine split: Podman deploys the PARSED model by translating it to native libpod resources (no external
// CLI — the app IS the compose engine). Docker has no libpod, so it shells `docker compose` against the
// original file (Docker parses it itself); the resulting containers carry com.docker.compose.* labels and
// therefore appear in the merged Containers list as a stack automatically.

import { composeUp } from "@/container-client/compose/orchestrate";
import type {
  ComposeChangeSummary,
  ComposeDownOptions,
  ComposeProjectModel,
  ComposeSource,
  ComposeUpOptions,
} from "@/container-client/compose/types";
import { type CommandExecutionResult, ContainerEngine, type EngineConnectorSettings } from "@/env/Types";
import {
  buildComposeDownArgs,
  buildComposeUpArgs,
  buildComposeVersionArgs,
  parseComposeUpSummary,
} from "./compose-cli";
import { down } from "./compose-rest";
import { ResourceAdapter } from "./shared";

export class ComposeAdapter extends ResourceAdapter {
  async up(
    model: ComposeProjectModel,
    opts: ComposeUpOptions = {},
    source?: ComposeSource,
  ): Promise<ComposeChangeSummary> {
    if (this.host.ENGINE === ContainerEngine.DOCKER) {
      return this.dockerUp(model, opts, source);
    }
    // Podman — translate the parsed model to libpod resources; bind sources are guest-resolved for scoped hosts.
    const settings = await this.host.getSettings().catch(() => undefined);
    const scope = settings?.controller?.scope ?? "";
    const resolvePath = (localPath: string) => this.host.resolveGuestPath(localPath, scope, settings);
    return composeUp(await this.driver(), model, opts, { resolvePath });
  }

  async down(project: string, opts: ComposeDownOptions = {}): Promise<void> {
    if (this.host.ENGINE === ContainerEngine.DOCKER) {
      const settings = await this.host.getSettings().catch(() => undefined);
      const scope = settings?.controller?.scope ?? "";
      const result = await this.execCompose(
        buildComposeDownArgs({ project, removeVolumes: opts.removeVolumes }),
        settings,
        scope,
      );
      if (!result.success) {
        throw new Error(composeError(result, `Could not tear down "${project}"`));
      }
      return;
    }
    return down(await this.driver(), project, opts);
  }

  // Docker: `docker compose -f <file> -p <name> up -d`, after probing that the compose v2 plugin exists.
  private async dockerUp(
    model: ComposeProjectModel,
    opts: ComposeUpOptions,
    source?: ComposeSource,
  ): Promise<ComposeChangeSummary> {
    if (!source?.path) {
      throw new Error("A compose file path is required to deploy on Docker.");
    }
    const settings = await this.host.getSettings().catch(() => undefined);
    const scope = settings?.controller?.scope ?? "";
    // `docker compose -f <file>` runs in the (possibly scoped) engine host — translate the local path to the guest.
    const file = await this.host.resolveGuestPath(source.path, scope, settings);
    // Pre-flight: a legible error if the plugin is missing, not a cryptic "'compose' is not a docker command".
    const probe = await this.execCompose(buildComposeVersionArgs(), settings, scope);
    if (!probe.success) {
      throw new Error("Docker Compose v2 is not available — the `docker compose` plugin was not found on this engine.");
    }
    const args = buildComposeUpArgs({ file, project: model.name || undefined, removeOrphans: opts.removeOrphans });
    const result = await this.execCompose(args, settings, scope);
    if (!result.success) {
      throw new Error(composeError(result, `Could not deploy "${model.name}"`));
    }
    return parseComposeUpSummary(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }

  private execCompose(
    args: string[],
    settings: EngineConnectorSettings | undefined,
    scope: string,
  ): Promise<CommandExecutionResult> {
    const program = settings?.program?.path || settings?.program?.name || "docker";
    return this.host.isScoped()
      ? this.host.runScopeCommand(program, args, scope, settings)
      : this.host.runHostCommand(program, args, settings);
  }
}

function composeError(result: CommandExecutionResult, fallback: string): string {
  return (result.stderr || result.stdout || "").trim() || fallback;
}
