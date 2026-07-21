import { describe, expect, it } from "vitest";
import { createMockLanguageModel } from "./aiMocks";

async function drainIgnoringError(stream: ReadableStream<any>): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) {
        return;
      }
    }
  } catch {
    // The error-stream path rejects on purpose; we only care about the post-settle abort below.
  }
}

// The mock's hand-rolled streams close their controller on both normal completion AND signal abort. The
// XState segmentActor returns abort() as its teardown, so the machine aborts the signal AFTER the stream has
// already settled — a second close()/error() on a settled controller throws ERR_INVALID_STATE as an *uncaught*
// exception (it does not propagate through abort()), which previously crashed the Electron main process. The
// stream teardown must therefore be idempotent.
describe("createMockLanguageModel stream lifecycle", () => {
  async function expectNoUncaughtOnPostSettleAbort(prompt: string): Promise<void> {
    const model = createMockLanguageModel();
    const ac = new AbortController();
    const { stream } = await (model as any).doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      abortSignal: ac.signal,
    });
    await drainIgnoringError(stream);

    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    process.on("uncaughtException", onUncaught);
    try {
      ac.abort();
      await new Promise((resolve) => setTimeout(resolve, 25));
    } finally {
      process.off("uncaughtException", onUncaught);
    }
    expect(uncaught).toEqual([]);
  }

  it("tolerates abort after a completed stream (idempotent close)", async () => {
    await expectNoUncaughtOnPostSettleAbort("please restart the web container");
  });

  it("tolerates abort after an errored stream (idempotent teardown)", async () => {
    await expectNoUncaughtOnPostSettleAbort("simulate a model error");
  });
});
