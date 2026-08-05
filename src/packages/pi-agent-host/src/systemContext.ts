// The app's project rules and memories, given to the model as system prose. The app cannot compose the whole
// system prompt — pi assembles that inside the container from its own guidelines, the tool list and the mounted
// workspace's context files — so it sends only its own prose and this appends it to whatever pi built for the turn.
//
// It is applied per turn rather than once at start because the user can add a memory or enable rules while the
// session runs, and a session that kept the set it was born with would be exactly as silent as no injection at all.

import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";

type NamedInlineExtension = Extract<InlineExtension, { factory: ExtensionFactory }>;

export interface SystemContextExtension {
  extension: NamedInlineExtension;
  // Blank clears it, so the next turn is exactly pi's own prompt again — what the user sees when they turn the
  // project rules off.
  set(text: string): void;
}

export function createSystemContextExtension(): SystemContextExtension {
  let context = "";
  return {
    set(text: string) {
      context = text.trim();
    },
    extension: {
      name: "container-desktop-system-context",
      factory: (pi) => {
        // pi chains this handler's answer through the other extensions', so `event.systemPrompt` is what the turn
        // would otherwise have been sent — appending keeps every one of them.
        pi.on("before_agent_start", (event) =>
          context ? { systemPrompt: `${event.systemPrompt}\n\n${context}` } : undefined,
        );
      },
    },
  };
}
