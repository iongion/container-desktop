// Incremental parser for `docker buildx build --progress=rawjson`. Each newline-delimited line is a JSON
// object with `vertexes` (build steps), `logs` (base64-encoded output attributed to a vertex digest) and
// `statuses` (transfer progress, ignored here). Steps are keyed by vertex digest and assigned a stable
// ordinal on first sight. Partial lines and non-JSON noise are tolerated.

import type { BuildEvent, BuildProgressParser, BuildStep } from "../types";

interface RawVertex {
  digest?: string;
  name?: string;
  started?: string;
  completed?: string;
  cached?: boolean;
  error?: string;
}

interface RawLog {
  vertex?: string;
  stream?: number; // 1 = stdout, 2 = stderr
  msg?: string; // base64
}

// buildx's exporter logs the final image config digest as "writing image sha256:…" — that hex is the IMAGE ID
// (what `docker images` shows), which the Layers tab resolves via image history.
const WRITING_IMAGE_RE = /writing image sha256:([0-9a-f]{64})/;

function decodeBase64(value: string): string {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
}

function statusFor(vertex: RawVertex): BuildStep["status"] {
  if (vertex.error) {
    return "error";
  }
  if (vertex.cached) {
    return "cached";
  }
  if (vertex.completed) {
    return "done";
  }
  return "running";
}

export function createRawjsonParser(): BuildProgressParser {
  let buffer = "";
  const steps = new Map<string, BuildStep>();
  let order = 0;

  const handleVertex = (vertex: RawVertex, events: BuildEvent[]) => {
    const digest = vertex.digest;
    if (!digest) {
      return;
    }
    let step = steps.get(digest);
    if (!step) {
      order += 1;
      step = { key: digest, index: order, name: vertex.name ?? digest, status: "running", cached: false, logs: [] };
      steps.set(digest, step);
    }
    if (vertex.name) {
      step.name = vertex.name;
    }
    step.cached = Boolean(vertex.cached);
    step.status = statusFor(vertex);
    if (vertex.error) {
      step.error = vertex.error;
    }
    if (vertex.started && !step.startedAt) {
      step.startedAt = Date.parse(vertex.started) || Date.now();
    }
    if (vertex.completed) {
      step.completedAt = Date.parse(vertex.completed) || Date.now();
      if (step.startedAt && step.completedAt >= step.startedAt) {
        step.durationMs = step.completedAt - step.startedAt;
      }
    }
    events.push({ type: "step", step: { ...step } });
  };

  const handleLog = (log: RawLog, events: BuildEvent[]) => {
    if (!log.vertex || !log.msg) {
      return;
    }
    const step = steps.get(log.vertex);
    if (!step) {
      return;
    }
    const text = decodeBase64(log.msg);
    const logLine = { ts: Date.now(), stream: log.stream === 2 ? ("stderr" as const) : ("stdout" as const), text };
    step.logs.push(logLine);
    events.push({ type: "log", key: step.key, line: logLine });
    const idMatch = text.match(WRITING_IMAGE_RE);
    if (idMatch) {
      events.push({ type: "image", imageId: idMatch[1] });
    }
  };

  const handleLine = (line: string, events: BuildEvent[]) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let parsed: { vertexes?: RawVertex[]; logs?: RawLog[] };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return; // non-JSON noise (buildx occasionally prints a plain line)
    }
    for (const vertex of parsed.vertexes ?? []) {
      handleVertex(vertex, events);
    }
    for (const log of parsed.logs ?? []) {
      handleLog(log, events);
    }
  };

  return {
    push(_from, chunk) {
      const events: BuildEvent[] = [];
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        handleLine(part, events);
      }
      return events;
    },
  };
}
