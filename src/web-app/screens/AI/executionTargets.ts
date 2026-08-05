// What the start form can offer for the two execution targets that need a REFERENCE: an existing container to
// enter, or the image a disposable one is created from. Both are read from the connection the session will run
// on, so the offer is what that engine actually has — not a name the user has to remember.
//
// Pure on purpose: the drawer renders these, and the rules (only a running container can be entered, only a
// tagged image can be named) are asserted without a picker.

import type { Container } from "@/container-client/types/container";
import type { ContainerImage } from "@/container-client/types/image";
import { shortId } from "@/web-app/components/inspectSummary.helpers";
import { imageDisplayName } from "@/web-app/screens/Image/Navigation";

export interface ExecutionTargetOption {
  // Exactly what the form submits: a container name-or-id, or an image reference.
  reference: string;
  label: string;
  // What tells two otherwise identical rows apart — the image a container runs, and the short id.
  meta: string;
}

// The name the list screens show, then the engine's own name, then the short id — a row is never blank.
function containerLabel(container: Container): string {
  return container.Computed?.Name || (container.Names?.[0] || "").replace(/^\//, "") || shortId(container.Id);
}

export function runningContainerOptions(containers: readonly Container[]): ExecutionTargetOption[] {
  return containers
    .filter((container) => container.Computed?.DecodedState === "running")
    .map((container) => ({
      reference: containerLabel(container),
      label: containerLabel(container),
      meta: [container.Image, shortId(container.Id)].filter(Boolean).join(" · "),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function pulledImageOptions(images: readonly ContainerImage[]): ExecutionTargetOption[] {
  return (
    images
      .map((image) => ({ image, reference: imageDisplayName(image) }))
      // An untagged image resolves to its short id, which is not a reference a start form can name.
      .filter(({ image, reference }) => reference !== shortId(image.Id) && reference !== "<none>")
      .map(({ image, reference }) => ({ reference, label: reference, meta: shortId(image.Id) }))
      .sort((left, right) => left.label.localeCompare(right.label))
  );
}

export function executionTargetMatches(option: ExecutionTargetOption, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return `${option.label} ${option.meta}`.toLowerCase().includes(normalized);
}
