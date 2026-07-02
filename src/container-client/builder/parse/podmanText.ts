// Incremental parser for Podman/Buildah plain build output. Buildah prints one `STEP n/m: <instruction>`
// per instruction, a `--> Using cache <id>` line when a step is reused, and a bare `--> <id>` / commit line
// when it is (re)built. We turn that stream into upserted BuildStep snapshots + attributed log lines. Partial
// lines are buffered across chunks. When output has NO STEP markers at all, a single synthetic step collects
// everything so the timeline still shows something.

import type { BuildEvent, BuildProgressParser, BuildStep } from "../types";

const STEP_RE = /^STEP\s+(\d+)\/(\d+):\s*(.*)$/;
const USING_CACHE_RE = /^-->\s+Using cache\b/;
// Podman/Buildah print the committed image's full id on its own trailing line (bare 64-hex, sometimes with a
// sha256: prefix). Last match wins — it is the very last thing printed, after any id echoed in build output.
const IMAGE_ID_RE = /^(?:sha256:)?([0-9a-f]{64})$/;

export function createPodmanTextParser(): BuildProgressParser {
  let buffer = "";
  let current: BuildStep | undefined;
  let syntheticMade = false;

  const ensureSynthetic = (events: BuildEvent[]) => {
    if (!current && !syntheticMade) {
      syntheticMade = true;
      current = { key: "podman-1", index: 1, name: "build", status: "running", cached: false, logs: [] };
      events.push({ type: "step", step: current });
    }
  };

  const handleLine = (from: "stdout" | "stderr", line: string, events: BuildEvent[]) => {
    const stepMatch = line.match(STEP_RE);
    if (stepMatch) {
      const index = Number(stepMatch[1]);
      const total = Number(stepMatch[2]);
      current = {
        key: `podman-${index}`,
        index,
        total,
        name: stepMatch[3].trim(),
        status: "running",
        cached: false,
        logs: [],
        startedAt: Date.now(),
      };
      events.push({ type: "step", step: current });
      return;
    }
    if (current && USING_CACHE_RE.test(line)) {
      current.cached = true;
      current.status = "cached";
      current.completedAt = Date.now();
      events.push({ type: "step", step: { ...current } });
      return;
    }
    const idMatch = line.trim().match(IMAGE_ID_RE);
    if (idMatch) {
      events.push({ type: "image", imageId: idMatch[1] });
    }
    // Any other non-empty line is output for the current step (creating a synthetic one if needed).
    if (line.length === 0) {
      return;
    }
    ensureSynthetic(events);
    if (current) {
      const logLine = { ts: Date.now(), stream: from, text: line };
      current.logs.push(logLine);
      events.push({ type: "log", key: current.key, line: logLine });
    }
  };

  return {
    push(from, chunk) {
      const events: BuildEvent[] = [];
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        handleLine(from, part.replace(/\r$/, ""), events);
      }
      return events;
    },
  };
}
