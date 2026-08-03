// Parse the standard unified patch pi's `edit` tool returns in `details.patch`, so the diff card renders real
// hunks with both line-number gutters instead of re-deriving a diff from reconstructed file contents.
//
// A hunk is consumed by its declared line counts rather than by looking for the next header. That is what
// makes an added line whose own content begins "+++" unambiguous: inside an unfinished hunk it is content,
// and only after the counts are satisfied does "+++" read as a file header again.
//
// Malformed input never throws — a card that renders nothing is recoverable, an exception in a transcript is
// not. Pure: no react, no node, no sibling layers.

export interface PatchLine {
  kind: "context" | "added" | "removed";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface PatchHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: PatchLine[];
}

export interface ParsedPatch {
  path?: string;
  hunks: PatchHunk[];
  added: number;
  removed: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// `+++ b/src/app.ts` and `+++ src/app.ts` both name the same file; a tab-separated timestamp is optional.
function headerPath(value: string): string | undefined {
  const path = value.split("\t")[0].trim();
  if (!path || path === "/dev/null") return undefined;
  return path.replace(/^[ab]\//, "");
}

export function parseUnifiedPatch(patch: string): ParsedPatch {
  const hunks: PatchHunk[] = [];
  let path: string | undefined;
  let added = 0;
  let removed = 0;

  let hunk: PatchHunk | undefined;
  let oldRemaining = 0;
  let newRemaining = 0;
  let oldLine = 0;
  let newLine = 0;

  const closeIfComplete = () => {
    if (hunk && oldRemaining <= 0 && newRemaining <= 0) hunk = undefined;
  };

  for (const raw of patch.split("\n")) {
    // A body line always begins with a space, "+", "-" or "\", so "@@" is unambiguous even mid-hunk. Checking
    // it first means a hunk whose declared counts overstate its body still ends where the next one starts.
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      oldRemaining = header[2] === undefined ? 1 : Number(header[2]);
      newRemaining = header[4] === undefined ? 1 : Number(header[4]);
      hunk = { header: raw, oldStart: oldLine, newStart: newLine, lines: [] };
      hunks.push(hunk);
      // A hunk that declares no lines on either side is already finished.
      closeIfComplete();
      continue;
    }

    if (!hunk) {
      if (raw.startsWith("+++ ")) path = headerPath(raw.slice(4)) ?? path;
      // Everything else outside a hunk — the --- header, an Index: line, git's extended headers, prose in a
      // malformed patch — carries nothing the card renders.
      continue;
    }

    // jsdiff writes "\ No newline at end of file"; it annotates the previous line and occupies neither side.
    if (raw.startsWith("\\")) continue;

    const marker = raw.charAt(0);
    if (marker === "+") {
      hunk.lines.push({ kind: "added", text: raw.slice(1), newLine });
      newLine++;
      newRemaining--;
      added++;
    } else if (marker === "-") {
      hunk.lines.push({ kind: "removed", text: raw.slice(1), oldLine });
      oldLine++;
      oldRemaining--;
      removed++;
    } else if (marker === " " || raw === "") {
      // A context line is a space plus content, but patches in the wild drop the space on an empty line.
      hunk.lines.push({ kind: "context", text: raw.slice(1), oldLine, newLine });
      oldLine++;
      newLine++;
      oldRemaining--;
      newRemaining--;
    } else {
      // Not a patch body line: the hunk was short, so stop trusting its counts.
      hunk = undefined;
      continue;
    }
    closeIfComplete();
  }

  return { path, hunks, added, removed };
}
