// Reads a session's own entries back out as the bridge events the live path would have emitted for them.
//
// pi replaces a session in process — `/new`, `/resume`, `/clone`, `/import` — while the app's transcript is a
// projection of the events it happened to see, not of pi's store. Without this a replaced session lands the user in
// front of an empty screen while the model still holds the whole conversation.
//
// Every entry becomes exactly what its live counterpart emits, and an entry the live path has no event for adds
// nothing: the renderer keeps ONE projection instead of two that drift.

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { textOfContent } from "@/pi-agent-host/events";
import type { BridgeEvent } from "@/pi-bridge/protocol";

// pi's `AgentMessage`, reached through the entry that carries it rather than by importing pi-agent-core — the
// message union is pi's, and this package depends on pi's coding agent, not on its agent core.
type SessionMessage = Extract<SessionEntry, { type: "message" }>["message"];

function messageEvents(message: SessionMessage): BridgeEvent[] {
  switch (message.role) {
    case "user":
      return [{ type: "user_message", text: textOfContent(message.content) }];

    case "assistant": {
      // The assistant's own words first, then the calls it asked for — the order pi streams them in, so a replayed
      // turn reads exactly like the one the user watched.
      const events: BridgeEvent[] = [
        { type: "assistant_end", text: textOfContent(message.content), stopReason: message.stopReason },
      ];
      for (const block of message.content) {
        if (block.type === "toolCall") {
          events.push({ type: "tool_start", toolCallId: block.id, toolName: block.name, args: block.arguments });
        }
      }
      return events;
    }

    case "toolResult":
      return [
        {
          type: "tool_end",
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          isError: message.isError,
          text: textOfContent(message.content),
          details: message.details,
        },
      ];

    // A plugin's own message, appended as a message rather than as a `custom_message` entry. Same rules as live:
    // the customType picks the card, and `display: false` means the plugin was feeding the model, not the user.
    case "custom":
      if (!message.customType || message.display === false) return [];
      return [
        {
          type: "custom_message",
          customType: message.customType,
          content: textOfContent(message.content),
          details: message.details,
        },
      ];

    // pi's `!command`, which this GUI has no way to run — so it only arrives in an imported session. Rendering it as
    // nothing would leave a hole in a conversation the model still remembers.
    case "bashExecution":
      return [
        {
          type: "custom_message",
          customType: "bashExecution",
          content: `${message.command}\n${message.output}`,
          details: {
            exitCode: message.exitCode,
            cancelled: message.cancelled,
            truncated: message.truncated,
          },
        },
      ];

    default:
      return [];
  }
}

export function replaySessionEntries(entries: readonly SessionEntry[]): BridgeEvent[] {
  return entries.flatMap((entry) => {
    switch (entry.type) {
      case "message":
        return messageEvents(entry.message);
      // `pi.appendEntry(customType, data)`, which live arrives as `entry_appended`.
      case "custom":
        return [{ type: "entry", entryId: entry.id, customType: entry.customType, data: entry.data } as BridgeEvent];
      // `pi.sendMessage({ customType, … })`, which pi stores as its own entry type and streams as a custom message.
      case "custom_message":
        if (!entry.display) return [];
        return [
          {
            type: "custom_message",
            customType: entry.customType,
            content: textOfContent(entry.content),
            details: entry.details,
          } as BridgeEvent,
        ];
      // pi's bookkeeping — compactions, branch summaries, model and thinking changes, labels, the session name.
      // The live path emits nothing for any of them, so neither does this.
      default:
        return [];
    }
  });
}

// Whether part of this branch is a summary rather than the turns themselves. The host holds this for the life of a
// session, so a replaced one has to re-derive it: reporting the predecessor's compaction would tell the user their
// history was summarised when none of it was.
export function sessionWasCompacted(entries: readonly SessionEntry[]): boolean {
  return entries.some((entry) => entry.type === "compaction");
}
