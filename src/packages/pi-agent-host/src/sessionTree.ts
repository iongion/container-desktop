// pi's session tree, projected into the shape a picker can render. Pure, so the mapping is testable without a
// session — and kept out of `piCommands.ts` because it is the only place that has to know pi's entry union.
//
// The projection is deliberately lossy. pi's `SessionEntry` carries whole message bodies and a union the app has no
// business knowing; a branch picker needs an id to switch to, pi's own word for what the entry is, and enough text to
// recognise the moment. Sending the raw tree would put the entire conversation on the wire twice.

import type { SessionEntry, SessionTreeNode } from "@earendil-works/pi-coding-agent";
import type { PiSessionTreeNode } from "@/pi-bridge/protocol";

// Enough to recognise a point in the conversation in one list row. Longer previews turn the picker into a transcript.
const PREVIEW_LIMIT = 160;

interface MessageLike {
  role?: unknown;
  content?: unknown;
}

function messageOf(entry: SessionEntry): MessageLike | undefined {
  const message = (entry as { message?: unknown }).message;
  return typeof message === "object" && message !== null ? (message as MessageLike) : undefined;
}

// Both shapes pi stores: a plain string body, or the block array a model answers with. Only text blocks contribute —
// an image would otherwise render as `[object Object]`.
function messageText(message: MessageLike): string {
  const { content } = message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const text = (block as { type?: unknown; text?: unknown }).text;
      return (block as { type?: unknown }).type === "text" && typeof text === "string" ? text : "";
    })
    .filter((text) => text.length > 0)
    .join(" ");
}

function field(entry: SessionEntry, key: string): string {
  const value = (entry as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

// What this entry says about itself. A message shows its body; every other kind has no body, so it is described by
// what it CHANGED — which is the only thing that tells two adjacent `model_change` entries apart.
function preview(entry: SessionEntry): string {
  const message = messageOf(entry);
  const text = message
    ? messageText(message)
    : entry.type === "model_change"
      ? `${field(entry, "provider")}/${field(entry, "modelId")}`
      : entry.type === "thinking_level_change"
        ? field(entry, "thinkingLevel")
        : field(entry, "summary") || field(entry, "label");
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > PREVIEW_LIMIT ? `${collapsed.slice(0, PREVIEW_LIMIT - 1)}…` : collapsed;
}

function role(entry: SessionEntry): string | undefined {
  const value = messageOf(entry)?.role;
  return typeof value === "string" ? value : undefined;
}

// The ids from the root down to the leaf. A picker has to show which branch is live, and pi answers that with a leaf
// id alone — so the path is reconstructed once here rather than re-walked per node.
function pathToLeaf(nodes: readonly SessionTreeNode[], leafId: string): string[] | undefined {
  for (const node of nodes) {
    if (node.entry.id === leafId) return [node.entry.id];
    const below = pathToLeaf(node.children, leafId);
    if (below) return [node.entry.id, ...below];
  }
  return undefined;
}

function project(nodes: readonly SessionTreeNode[], current: ReadonlySet<string>): PiSessionTreeNode[] {
  return nodes.map((node) => ({
    id: node.entry.id,
    kind: node.entry.type,
    ...(role(node.entry) ? { role: role(node.entry) } : {}),
    preview: preview(node.entry),
    ...(node.label ? { label: node.label } : {}),
    timestamp: node.entry.timestamp,
    current: current.has(node.entry.id),
    children: project(node.children, current),
  }));
}

export function projectSessionTree(nodes: readonly SessionTreeNode[], leafId: string | null): PiSessionTreeNode[] {
  const current = new Set(leafId ? (pathToLeaf(nodes, leafId) ?? []) : []);
  return project(nodes, current);
}
