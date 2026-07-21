import { type EngineThemePreference, OperatingSystem } from "@/container-client/types/os";

// State-free environment / preference helpers. Lifted verbatim from Application.ts (no behavior change).

export function normalizeTheme(theme: string | undefined): "bp6-dark" | "bp6-light" {
  if (theme === "light" || theme === "bp6-light") {
    return "bp6-light";
  }
  return "bp6-dark";
}

export function normalizeEngineThemePreference(value: string | undefined): EngineThemePreference {
  // Apple Container is an engine, not a selectable theme: a stale stored "container" preference
  // normalizes to "auto" and resolves to the unified theme via engineTheme.ts.
  return value === "podman" || value === "docker" || value === "unified" ? value : "auto";
}

// Format the raw, verbatim detail of a connection failure for the Activity Center: the SSH preflight steps
// when present (what was attempted, step by step), else the error stack, else the bare message. Never lossy —
// the whole point is that startup / connection-establishment failures keep their real cause.
export function describeConnectError(error: any): string | undefined {
  const steps = error?.report?.steps;
  if (Array.isArray(steps) && steps.length > 0) {
    const lines = steps.map((step: any) => {
      const mark = step?.skipped ? "·" : step?.ok ? "✓" : "✗";
      const id = step?.id ?? step?.label ?? "step";
      return step?.details ? `  ${mark} ${id} — ${step.details}` : `  ${mark} ${id}`;
    });
    return ["SSH preflight:", ...lines].join("\n");
  }
  if (typeof error?.stack === "string" && error.stack.trim()) {
    return error.stack;
  }
  return error?.message ? `${error.message}` : undefined;
}

// Detects the OS from navigator.userAgent (reads a global — only valid in the renderer context).
export function detectOperatingSystem() {
  let OSName = "Unknown OS";
  if (navigator.userAgent.indexOf("Win") !== -1) OSName = "Windows";
  if (navigator.userAgent.indexOf("Mac") !== -1) OSName = "MacOS";
  if (navigator.userAgent.indexOf("X11") !== -1) OSName = "UNIX";
  if (navigator.userAgent.indexOf("Linux") !== -1) OSName = "Linux";
  switch (OSName) {
    case "Windows":
      return OperatingSystem.Windows;
    case "MacOS":
      return OperatingSystem.MacOS;
    case "Linux":
    case "Unix":
      return OperatingSystem.Linux;
    default:
      return OperatingSystem.Unknown;
  }
}
