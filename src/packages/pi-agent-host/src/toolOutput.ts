// Reading back the file pi's bash executor writes when it truncates a command's output. The tool result only
// carries the PATH (`details.fullOutputPath`), and that path is inside this container, so the card cannot open
// it — this is the read that makes "Output truncated" actionable from the GUI.
//
// The path arrives from a tool result, which a plugin can author, so it is NOT trusted: it is checked against
// the exact shape pi's own executor produces (`<tmpdir>/pi-bash-<id>.log`, flat, no traversal) before anything
// is opened. Anything else is refused rather than read.

import { open, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

// 2 MiB of tail. Comfortably more than a human reads in a card, small enough to cross the socket as one frame.
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

const PI_BASH_LOG = /^pi-bash-[A-Za-z0-9._-]+\.log$/;

export interface ToolOutputRead {
  text: string;
  truncated: boolean;
}

export function isPiBashOutputPath(candidate: string): boolean {
  const absolute = resolve(candidate);
  const root = resolve(tmpdir());
  // Compare against `<root>/<name>` rather than a prefix test: a prefix would also accept a sibling directory
  // whose name merely starts with the temp dir's, and a nested path that happens to end in the right name.
  return absolute === `${root}/${basename(absolute)}` && PI_BASH_LOG.test(basename(absolute));
}

export async function readToolOutput(path: string, maxBytes = DEFAULT_MAX_BYTES): Promise<ToolOutputRead> {
  if (!isPiBashOutputPath(path)) throw new Error(`${path} is not a pi tool-output file`);
  const { size } = await stat(path);
  const handle = await open(path, "r");
  try {
    // The tail, not the head: a truncated command's interesting part is where it stopped — the error, the last
    // lines of a build — not the banner it opened with.
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return { text: buffer.toString("utf8"), truncated: length < size };
  } finally {
    await handle.close();
  }
}
