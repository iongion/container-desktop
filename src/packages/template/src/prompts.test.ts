import { describe, expect, it } from "vitest";
import { installPromptTemplates } from "@/template/templateRegistry";
import { buildAgentPrompt } from "./prompts";

// Minimal inline templates that match the .md files so tests don't need fs.
const TEMPLATES = {
  agent: [
    "You are the container-desktop diagnostic agent for Podman, Docker, WSL and SSH engines.",
    "Investigate the user's problem methodically using your tools:",
    "- `runCommand` runs a host command (bare program + args array, never a shell). Read-only commands run automatically; state-changing ones are NOT run by you — they are surfaced to the user to approve.",
    "- `searchKnowledge` looks up known fixes in the built-in troubleshooting bank.",
    "- `webSearch`, when available, searches the public web.",
    "Rules: never fabricate command output; if a command needs approval, STOP and ask the user to run it, then reason about what they report. Prefer the knowledge bank first. Be concise and end with a clear, actionable recommendation.",
    "{% if os or engine or connection or screen or activity or resources or errors %}",
    "",
    "# Initial diagnostics context",
    "{% if os %}",
    "## OS",
    "{{ os }}",
    "{% endif %}",
    "{% if engine %}",
    "## Engine",
    "{{ engine }}",
    "{% endif %}",
    "{% if connection %}",
    "## Connection",
    "{{ connection }}",
    "{% endif %}",
    "{% if screen %}",
    "## Current screen",
    "{{ screen }}",
    "{% endif %}",
    "{% if activity %}",
    "## Recent activity",
    "{{ activity }}",
    "{% endif %}",
    "{% if resources %}",
    "## Resources",
    "{{ resources }}",
    "{% endif %}",
    "{% if errors %}",
    "## Recent errors",
    "{{ errors }}",
    "{% endif %}",
    "{% endif %}",
  ].join("\n"),
};

// Install the inline templates before any test runs.
installPromptTemplates(TEMPLATES);

describe("buildAgentPrompt — diagnostic agent (Nunjucks)", () => {
  it("returns the base agent prompt when no bundle is attached", () => {
    const p = buildAgentPrompt();
    expect(p).toContain("diagnostic agent");
    expect(p).not.toContain("# Initial diagnostics context");
  });

  it("includes diagnostics sections for each non-empty field", () => {
    const p = buildAgentPrompt({
      os: "Linux",
      engine: "podman",
      connection: "local rootless",
      screen: 'The user is currently viewing the "Containers" screen (id: containers).',
      activity: "started container web",
      resources: "containers=1 running=1",
      errors: "permission denied",
    });
    expect(p).toContain("# Initial diagnostics context");
    expect(p).toContain("## OS");
    expect(p).toContain("Linux");
    expect(p).toContain("## Engine");
    expect(p).toContain("podman");
    expect(p).toContain("## Connection");
    expect(p).toContain("local rootless");
    expect(p).toContain("## Current screen");
    expect(p).toContain('viewing the "Containers" screen');
    expect(p).toContain("## Recent activity");
    expect(p).toContain("## Resources");
    expect(p).toContain("## Recent errors");
  });

  it("omits the diagnostics section when all fields are empty", () => {
    const p = buildAgentPrompt({
      os: "",
      engine: undefined,
      connection: "",
    });
    expect(p).not.toContain("# Initial diagnostics context");
  });
});
