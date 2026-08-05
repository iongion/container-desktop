// Props every generative-UI tool card receives — mirrors the renderer's `tool` transcript item (minus the
// kind/id). `result` is the typed, already-redacted payload the tool emitted; cards narrow it to their own
// shape. The registry's <ToolCard> handles the running/error states centrally, so a card only renders its
// successful result.

export interface ToolCardProps {
  tool: string;
  title: string;
  // pi's id for this execution. A plugin tool that renders itself is matched to its surface by this, so a
  // card only ever paints the component belonging to its own call.
  toolCallId?: string;
  args: Record<string, unknown>;
  status: "running" | "complete" | "error";
  ok?: boolean;
  result?: unknown;
  sessionId?: string;
  message?: string;
}
