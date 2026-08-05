// The conversations the running session's workspace already has, as the header's session control needs them.
//
// pi answers a bare `/resume` with every session file it can see for the mounted folder — newest first, with the one
// the container is on marked. Choosing, labelling and searching them is pure, so what the control does is settled
// here rather than inside a component.

import type { PiSessionSummary } from "@/pi-bridge/protocol";

// What to call one in a list: pi's own name when the user gave it one, else the words the conversation opened with,
// which is what a person remembers it by. Neither is guaranteed, so an empty answer is a real answer — the caller
// says what an unnamed session is called, because that word is the app's and this module has no i18n.
export function workspaceSessionTitle(session: PiSessionSummary): string {
  return session.name?.trim() || session.firstMessage.trim();
}

// Matched on what the row SHOWS. Searching a field the user cannot see would look broken, and the order stays the
// container's: newest first is the answer to "where was I?".
export function filterWorkspaceSessions(sessions: readonly PiSessionSummary[], query: string): PiSessionSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...sessions];
  return sessions.filter((session) => workspaceSessionTitle(session).toLocaleLowerCase().includes(needle));
}

// pi's own name for the conversation the container is on. This is how the app learns the name of a session it did not
// name itself — a resumed one carries whatever it was last called, and only pi knows that.
export function currentWorkspaceSessionName(sessions: readonly PiSessionSummary[]): string | undefined {
  return sessions.find((session) => session.current)?.name?.trim() || undefined;
}
