// A "stack" is just a compose-labelled container group. These pure predicates let the Containers screen
// tell a compose project apart from an ordinary name-prefix group — so the "Stacks only" filter can narrow
// to real stacks and the group-header teardown action shows only where it applies. Both engine conventions
// are honored (docker-compose + podman-compose), same as the normalizer's grouping.

import { COMPOSE_PROJECT_LABELS } from "@/container-client/compose/labels";
import type { StackHookTarget } from "@/container-client/lifecycleHooks";
import type { Container } from "@/container-client/types/container";
import type { ContainerGroup } from "@/web-app/Types";
import type { MergedContainer } from "./flattenGroups";

// The owning compose project name (either engine's label), or undefined if the container isn't in a stack.
export function composeProjectOf(container: Container): string | undefined {
  const labels = container.Labels ?? undefined;
  if (!labels) {
    return undefined;
  }
  for (const key of COMPOSE_PROJECT_LABELS) {
    if (labels[key]) {
      return labels[key];
    }
  }
  return undefined;
}

// True when the container belongs to a compose project (i.e. it is part of a stack).
export function isComposeContainer(container: Container): boolean {
  return composeProjectOf(container) !== undefined;
}

// True when a container group is a compose project (any member carries a project label), not a name group.
export function isComposeGroup(group: ContainerGroup): boolean {
  return (group.Items as Container[]).some(isComposeContainer);
}

// The stack a group's lifecycle hooks are keyed by: its compose project, on the connection and engine of the member
// that carries the label. Undefined for a name-prefix group, which has no stack hooks.
export function stackHookTargetOf(containers: MergedContainer[]): StackHookTarget | undefined {
  for (const container of containers) {
    const name = composeProjectOf(container);
    if (name) {
      return { connectionId: container.connectionId, engine: `${container.engine}`, name };
    }
  }
  return undefined;
}
