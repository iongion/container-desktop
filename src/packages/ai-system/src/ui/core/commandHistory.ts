// In-memory (non-persistent) command history for the AI composer — quake-console style: the messages the user
// has sent this run, recalled with Up/Down. Module-level so it survives composer remounts (the console's lazy
// mount, page navigation) and is shared by the console and the full page; it is never written to disk and
// resets on reload. Navigation is a pure function so it can be unit-tested without React.
import { MAX_COMMAND_HISTORY_ENTRIES } from "@/ai-system/core/limits";

const entries: string[] = [];

export function pushCommand(text: string): void {
  const value = text.trim();
  if (!value || entries[entries.length - 1] === value) {
    return;
  }
  entries.push(value);
  if (entries.length > MAX_COMMAND_HISTORY_ENTRIES) {
    entries.splice(0, entries.length - MAX_COMMAND_HISTORY_ENTRIES);
  }
}

export function commandHistory(): readonly string[] {
  return entries;
}

// Test-only reset (module state is process-global); no production caller.
export function clearCommandHistory(): void {
  entries.length = 0;
}

// Move through history. `index` is the current position (null = the live draft, i.e. not navigating). "up"
// steps toward older entries (clamped at the oldest); "down" toward newer, returning to the live draft once
// past the newest entry.
export function navigateHistory(
  history: readonly string[],
  index: number | null,
  direction: "up" | "down",
  liveDraft: string,
): { index: number | null; value: string } {
  if (history.length === 0) {
    return { index: null, value: liveDraft };
  }
  if (direction === "up") {
    const next = index === null ? history.length - 1 : Math.max(0, index - 1);
    return { index: next, value: history[next] };
  }
  if (index === null || index >= history.length - 1) {
    return { index: null, value: liveDraft };
  }
  const next = index + 1;
  return { index: next, value: history[next] };
}
