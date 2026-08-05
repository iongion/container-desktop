import { describe, expect, it } from "vitest";

import { parseKnowledgeBank, searchKnowledgeBank } from "@/ai-system/core/knowledgeBank";
import knowledgeMarkdown from "@/resources/prompts/knowledge-bank.md?raw";
import { parseMarkdownSections } from "@/template/markdownSections";

const REAL = parseKnowledgeBank(parseMarkdownSections(knowledgeMarkdown));

describe("parseKnowledgeBank", () => {
  it("reads every shipped entry, keeping the file's order", () => {
    expect(REAL.length).toBeGreaterThan(5);
    expect(REAL[0].id).toBe("podman-rootless-socket");
    expect(new Set(REAL.map((entry) => entry.id)).size).toBe(REAL.length);
  });

  it("reads the curator's own fields, and unwraps the commands", () => {
    const entry = REAL.find((candidate) => candidate.id === "podman-rootless-socket");
    expect(entry).toMatchObject({
      domain: "podman",
      title: "Rootless Podman API socket not available",
    });
    expect(entry?.symptom).toMatch(/podman\.sock/);
    expect(entry?.tags).toContain("rootless");
    // A `- \`command\`` list is the command, not markdown for the model to strip.
    expect(entry?.commands).toEqual([
      "systemctl --user enable --now podman.socket",
      "systemctl --user status podman.socket",
    ]);
  });

  it("declares a domain the port knows, for every entry", () => {
    for (const entry of REAL) {
      expect(["podman", "docker", "wsl", "ssh", "general"], entry.id).toContain(entry.domain);
    }
  });

  // Half an answer about a real failure is worse than none: the model would act on it either way.
  it("drops an entry with no symptom or no solution rather than half-reporting it", () => {
    const partial = parseKnowledgeBank({
      "no-symptom": "### Title\n\nA\n\n### Solution\n\nB",
      "no-solution": "### Title\n\nA\n\n### Symptom\n\nB",
      complete: "### Title\n\nA\n\n### Symptom\n\nB\n\n### Solution\n\nC",
    });
    expect(partial.map((entry) => entry.id)).toEqual(["complete"]);
  });

  it("falls back to general for a domain nobody declared, and to the id for a missing title", () => {
    const [entry] = parseKnowledgeBank({ "some-id": "### Symptom\n\nS\n\n### Solution\n\nF" });
    expect(entry).toMatchObject({ id: "some-id", title: "some-id", domain: "general" });
  });
});

describe("searchKnowledgeBank", () => {
  it("finds the rootless socket entry from the symptom a user would report", () => {
    const found = searchKnowledgeBank(REAL, "cannot connect to podman socket");
    expect(found[0].id).toBe("podman-rootless-socket");
  });

  it("finds an entry by its tags and by its id", () => {
    expect(searchKnowledgeBank(REAL, "DOCKER_HOST").map((entry) => entry.id)).toContain("podman-rootless-socket");
    expect(searchKnowledgeBank(REAL, "ssh-host-key-changed")[0].id).toBe("ssh-host-key-changed");
  });

  it("answers nothing for a query about something the bank does not cover", () => {
    expect(searchKnowledgeBank(REAL, "kubernetes ingress annotations")).toEqual([]);
  });

  // A vague query must not hand the model the whole bank through the back door.
  it("caps what one search can answer with", () => {
    const found = searchKnowledgeBank(REAL, "docker podman connection socket permission");
    expect(found.length).toBeLessThanOrEqual(5);
  });

  it("ignores a query with nothing to match on", () => {
    expect(searchKnowledgeBank(REAL, "   ")).toEqual([]);
    expect(searchKnowledgeBank(REAL, "a")).toEqual([]);
  });
});
