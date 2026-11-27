import type { CommandExecutionResult } from "@/host-contract/exec";
// Renderer-facing compose adapter — the two write operations behind "Import stack" (up) and the
// compose-group teardown (down). Listing/status/start/stop are intentionally absent: a stack is just a
// compose-labelled container group, so the merged container store already provides the list and per-service
// state, and group start/stop is the existing per-group bulk action on the Containers screen.
//
// Engine split: Podman deploys the PARSED model by translating it to native libpod resources (no external
// CLI — the app IS the compose engine). Docker has no libpod, so it shells `docker compose` against the
// original file (Docker parses it itself); the resulting containers carry com.docker.compose.* labels and
// therefore appear in the merged Containers list as a stack automatically. Apple Container has no compose of its own:
// the Docker CLI's compose runs against the socktainer socket, the Docker API Apple's engine is reached through.

import { composeUp } from "@/container-client/compose/orchestrate";
import type {
  ComposeChangeSummary,
  ComposeDownOptions,
  ComposeProjectModel,
  ComposeSource,
  ComposeUpOptions,
} from "@/container-client/compose/types";
import { getContainerLifecycleHooks } from "@/container-client/lifecycleHooks";
import { dockerTargetArgs } from "@/container-client/runtimes/dialects/docker";
import type { EngineConnectorSettings } from "@/container-client/types/connection";
import { ContainerEngine } from "@/container-client/types/engine";
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
    // The stack's before-start hook runs first and can refuse the import.
    await getContainerLifecycleHooks()?.stackBeforeStart(this.stackHookTarget(model.name));
    const settings = await this.host.getSettings().catch(() => undefined);
    const cli = this.composeCli(settings);
    if (cli) {
      return this.cliUp(cli, settings, model, opts, source);
    }
    // Podman — translate the parsed model to libpod resources; bind sources are guest-resolved for scoped hosts.
    const scope = settings?.controller?.scope ?? "";
    const resolvePath = (localPath: string) => this.host.resolveGuestPath(localPath, scope, settings);
    return composeUp(await this.driver(), model, opts, { resolvePath });
  }

  // Tears the stack down, then runs its after-stop hook.
  async down(project: string, opts: ComposeDownOptions = {}): Promise<void> {
    await this.teardown(project, opts);
    await getContainerLifecycleHooks()?.stackAfterStop(this.stackHookTarget(project));
  }

  private async teardown(project: string, opts: ComposeDownOptions): Promise<void> {
    const settings = await this.host.getSettings().catch(() => undefined);
    const cli = this.composeCli(settings);
    if (cli) {
      const args = buildComposeDownArgs({ project, removeVolumes: opts.removeVolumes });
      const result = await this.execCompose(cli, args, settings);
      if (!result.success) {
        throw new Error(composeError(result, `Could not tear down "${project}"`));
      }
      return;
    }
    return down(await this.driver(), project, opts);
  }

  // The `docker` CLI that deploys this connection's stacks, with the global flags aiming it at the connection's engine:
  // Docker's own pin (`--context`), or Apple's socktainer socket (`--host`). Undefined for Podman (REST, above).
  private composeCli(settings: EngineConnectorSettings | undefined): ComposeCli | undefined {
    if (this.host.ENGINE === ContainerEngine.DOCKER) {
      return {
        program: settings?.program?.path || settings?.program?.name || "docker",
        target: settings ? dockerTargetArgs(settings) : [],
        missing: "Docker Compose v2 is not available — the `docker compose` plugin was not found on this engine.",
      };
    }
    if (this.host.ENGINE === ContainerEngine.APPLE) {
      const connection = settings?.api?.connection;
      const socket = `${(this.host.isScoped() ? connection?.relay : connection?.uri) || ""}`.replace(/^unix:\/\//, "");
      return {
        program: "docker",
        target: ["--host", `unix://${socket}`],
        missing:
          "Compose on Apple Container needs the Docker CLI with its compose plugin (`docker compose`); install Docker's CLI to deploy stacks.",
      };
    }
    return undefined;
  }

  // `docker compose -f <file> -p <name> up -d`, after probing that the compose v2 plugin exists.
  private async cliUp(
    cli: ComposeCli,
    settings: EngineConnectorSettings | undefined,
    model: ComposeProjectModel,
    opts: ComposeUpOptions,
    source?: ComposeSource,
  ): Promise<ComposeChangeSummary> {
    if (!source?.path) {
      throw new Error("A compose file path is required to deploy with the Docker CLI.");
    }
    const scope = settings?.controller?.scope ?? "";
    // `docker compose -f <file>` runs in the (possibly scoped) engine host — translate the local path to the guest.
    const file = await this.host.resolveGuestPath(source.path, scope, settings);
    // Pre-flight: a legible error if the plugin is missing, not a cryptic "'compose' is not a docker command".
    const probe = await this.execCompose(cli, buildComposeVersionArgs(), settings);
    if (!probe.success) {
      throw new Error(cli.missing);
    }
    const args = buildComposeUpArgs({ file, project: model.name || undefined, removeOrphans: opts.removeOrphans });
    const result = await this.execCompose(cli, args, settings);
    if (!result.success) {
      throw new Error(composeError(result, `Could not deploy "${model.name}"`));
    }
    return parseComposeUpSummary(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }

  private execCompose(
    cli: ComposeCli,
    args: string[],
    settings: EngineConnectorSettings | undefined,
  ): Promise<CommandExecutionResult> {
    const argv = [...cli.target, ...args];
    return this.host.isScoped()
      ? this.host.runScopeCommand(cli.program, argv, settings?.controller?.scope ?? "", settings)
      : this.host.runHostCommand(cli.program, argv, settings);
  }
}

interface ComposeCli {
  program: string;
  // Global flags, before the `compose` subcommand.
  target: string[];
  // Why a deploy cannot run when `docker compose version` fails.
  missing: string;
}

function composeError(result: CommandExecutionResult, fallback: string): string {
  return (result.stderr || result.stdout || "").trim() || fallback;
}
