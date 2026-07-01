// Incremental parser for Apple Container `container build --progress=plain` output. It emits BuildKit-style
// `#<n>` grouped lines: `#3 [1/4] FROM …` names a vertex, `#3 CACHED` marks it reused, `#3 DONE 0.3s`
// completes it, `#3 ERROR …` fails it, and any other `#3 …` line is that vertex's output. Steps are keyed by
// vertex number; partial lines buffer across chunks.

import type { BuildEvent, BuildProgressParser, BuildStep } from "../types";

const VERTEX_RE = /^#(\d+)\s+(.*)$/;
const DONE_RE = /^DONE(?:\s+([\d.]+)s)?/;
// The exporter step logs "writing image sha256:…"; that hex is the built image id for the Layers tab.
const WRITING_IMAGE_RE = /writing image sha256:([0-9a-f]{64})/;

export function createAppleTextParser(): BuildProgressParser {
  let buffer = "";
  const steps = new Map<number, BuildStep>();
  let order = 0;

  const stepFor = (num: number) => {
    let step = steps.get(num);
    if (!step) {
      order += 1;
      step = { key: `#${num}`, index: order, name: "", status: "running", cached: false, logs: [] };
      steps.set(num, step);
    }
    return step;
  };

  const handleLine = (from: "stdout" | "stderr", line: string, events: BuildEvent[]) => {
    const match = line.match(VERTEX_RE);
    if (!match) {
      return;
    }
    const num = Number(match[1]);
    const rest = match[2].trim();
    const step = stepFor(num);
    if (rest === "CACHED") {
      step.cached = true;
      step.status = "cached";
      step.completedAt = Date.now();
    } else if (DONE_RE.test(rest)) {
      const seconds = rest.match(DONE_RE)?.[1];
      step.status = step.status === "error" ? "error" : "done";
      step.completedAt = Date.now();
      if (seconds) {
        step.durationMs = Math.round(Number(seconds) * 1000);
      }
    } else if (rest.startsWith("ERROR")) {
      step.status = "error";
      step.error = rest;
    } else if (!step.name && (rest.startsWith("[") || /^\S/.test(rest))) {
      // First substantive line names the vertex.
      step.name = rest;
      if (!step.startedAt) {
        step.startedAt = Date.now();
      }
    } else {
      const idMatch = rest.match(WRITING_IMAGE_RE);
      if (idMatch) {
        events.push({ type: "image", imageId: idMatch[1] });
      }
      const logLine = { ts: Date.now(), stream: from, text: rest };
      step.logs.push(logLine);
      events.push({ type: "log", key: step.key, line: logLine });
    }
    events.push({ type: "step", step: { ...step } });
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
