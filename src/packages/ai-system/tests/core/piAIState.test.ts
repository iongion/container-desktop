import { describe, expect, it } from "vitest";

import { piSessionSummary, piSessionUnavailable } from "@/ai-system/core/piAIState";
import { emptyPiThreadView, projectPiThreadView } from "@/ai-system/core/piThreadView";
import { threadSummarySchema } from "@/ai-system/core/schemas";

describe("piSessionSummary", () => {
  const base = { view: emptyPiThreadView("pi-session"), modelId: "some/model", startedAt: 1000 };

  it("produces a summary that satisfies the shipped ThreadSummary schema", () => {
    expect(() => threadSummarySchema.parse(piSessionSummary(base))).not.toThrow();
  });

  it("titles an empty session by its model", () => {
    expect(piSessionSummary(base).title).toBe("some/model");
  });

  it("titles the session from the first user message once one exists", () => {
    const view = projectPiThreadView(base.view, { type: "user_message", text: "fix the flaky test" });
    expect(piSessionSummary({ ...base, view }).title).toBe("fix the flaky test");
  });

  it("truncates a long first message rather than letting it blow the title limit", () => {
    const view = projectPiThreadView(base.view, { type: "user_message", text: "x".repeat(400) });
    const title = piSessionSummary({ ...base, view }).title;
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith("…")).toBe(true);
  });

  it("carries the view's phase and sequence so the UI can show live state", () => {
    const view = projectPiThreadView(base.view, { type: "assistant_delta", text: "hi" });
    const summary = piSessionSummary({ ...base, view });
    expect(summary.phase).toBe("model");
    expect(summary.lastSeq).toBe(view.lastSeq);
  });

  it("reports the model it was started with", () => {
    expect(piSessionSummary(base).model).toBe("some/model");
  });
});

describe("piSessionUnavailable", () => {
  it("rejects with a message naming the capability and the phase that will bring it", () => {
    const error = piSessionUnavailable("branchThread");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("branchThread");
  });
});
