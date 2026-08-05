import { describe, expect, it } from "vitest";
import type { SessionView } from "@/ai-system/core/sessionEvents";
import { sessionExportHtml, sessionHtmlFilename } from "@/ai-system/core/sessionExportHtml";

function view(timeline: SessionView["timeline"]): SessionView {
  return { sessionId: "pi-session", phase: "idle", lastSeq: timeline.length, timeline };
}

describe("sessionExportHtml", () => {
  it("writes one standalone document, with the conversation in order", () => {
    const html = sessionExportHtml("Release triage", "container-desktop-gateway/canned", "2026-08-04T10:00:00.000Z", {
      ...view([
        {
          kind: "message",
          id: "1",
          role: "user",
          content: "how many containers?",
          delivery: "applied",
          status: "complete",
        },
        { kind: "message", id: "2", role: "assistant", content: "Two.", delivery: "applied", status: "complete" },
      ]),
    });

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Release triage</title>");
    expect(html).toContain("container-desktop-gateway/canned");
    expect(html.indexOf("how many containers?")).toBeLessThan(html.indexOf("Two."));
    // Standalone means standalone: nothing to fetch, so it opens from a file with no app and no network.
    expect(html).not.toMatch(/<script|<link |src=|href=/);
  });

  // The conversation is model output and tool output. Both can contain anything, and this file is opened in a
  // browser — so every value goes through escaping, or a shared transcript is a scripting vector.
  it("escapes what the model and the tools said", () => {
    const html = sessionExportHtml("x", "m", "2026-08-04T10:00:00.000Z", {
      ...view([
        {
          kind: "message",
          id: "1",
          role: "assistant",
          content: "<img src=x onerror=alert(1)>",
          delivery: "applied",
          status: "complete",
        },
        {
          kind: "tool",
          id: "2",
          toolCallId: "c1",
          tool: "bash",
          title: "bash",
          args: { command: "echo '<script>'" },
          status: "complete",
          ok: true,
          message: "</pre><script>alert(2)</script>",
        },
      ]),
    });

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(2)");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows a tool call with its arguments, and marks one that failed", () => {
    const html = sessionExportHtml("x", "m", "2026-08-04T10:00:00.000Z", {
      ...view([
        {
          kind: "tool",
          id: "1",
          toolCallId: "c1",
          tool: "restartContainer",
          title: "restartContainer",
          args: { id: "web" },
          status: "error",
          ok: false,
          message: "no such container",
        },
      ]),
    });

    expect(html).toContain("restartContainer");
    expect(html).toContain("&quot;id&quot;: &quot;web&quot;");
    expect(html).toContain("no such container");
    expect(html).toContain("data-failed");
  });

  // A shared transcript carries what the user was asked and what they answered. Dropping the approvals would make a
  // gated run read as if nothing had ever been asked.
  it("keeps the approvals and the errors", () => {
    const html = sessionExportHtml("x", "m", "2026-08-04T10:00:00.000Z", {
      ...view([
        {
          kind: "approval",
          id: "1",
          approvalId: "a1",
          toolCallId: "c1",
          tool: "removeContainer",
          title: "removeContainer",
          args: { id: "web" },
          reason: "removes a container on podman-1",
          status: "rejected",
        },
        { kind: "error", id: "2", scope: "model", message: "the model returned an error" },
      ]),
    });

    expect(html).toContain("removeContainer");
    expect(html).toContain("rejected");
    expect(html).toContain("the model returned an error");
  });

  // A turn the model answered with nothing is part of the conversation. Without this a shared transcript shows a
  // question, no answer, and no reason for either — which is exactly the confusion the transcript notice removed.
  it("keeps a turn that produced no answer", () => {
    const html = sessionExportHtml("x", "m", "2026-08-04T10:00:00.000Z", {
      ...view([
        { kind: "message", id: "1", role: "user", content: "say alpha", delivery: "applied", status: "complete" },
        { kind: "notice", id: "2", notice: "empty-answer" },
      ]),
    });

    expect(html).toContain('data-kind="notice"');
    expect(html).toContain("answered with nothing");
  });

  it("names the file after the conversation, not after the clock alone", () => {
    expect(sessionHtmlFilename("Release triage")).toBe("release-triage.html");
    expect(sessionHtmlFilename("  ")).toBe("assistant-session.html");
    expect(sessionHtmlFilename("../../etc/passwd")).toBe("etc-passwd.html");
  });
});
