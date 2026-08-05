import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createSessionTrust } from "@/pi-agent-host/sessionControls";

const dirs = () => ({
  agentDir: mkdtempSync(join(tmpdir(), "cd-trust-agent-")),
  cwd: mkdtempSync(join(tmpdir(), "cd-trust-work-")),
});

describe("createSessionTrust", () => {
  // pi's settings manager trusts the project unless it is told otherwise, so an undecided project has to be reported
  // as untrusted the moment the session is built — not only once the user says no.
  it("reports an undecided project as untrusted at construction", () => {
    const decisions: boolean[] = [];
    const trust = createSessionTrust({ ...dirs(), onDecision: (trusted) => decisions.push(trusted) });
    expect(decisions).toEqual([false]);
    expect(trust.read().decision).toBeNull();
  });

  it("reports every decision, in the order it was made", () => {
    const decisions: boolean[] = [];
    const trust = createSessionTrust({ ...dirs(), onDecision: (trusted) => decisions.push(trusted) });
    expect(trust.write(true).decision).toBe(true);
    expect(trust.write(false).decision).toBe(false);
    expect(decisions).toEqual([false, true, false]);
  });

  // The decision lives in the AGENT dir, which is the named volume — so it survives the session that made it and
  // nothing is written into the user's workspace.
  it("remembers a decision across sessions on the same agent dir", () => {
    const paths = dirs();
    createSessionTrust({ ...paths }).write(true);
    const decisions: boolean[] = [];
    createSessionTrust({ ...paths, onDecision: (trusted) => decisions.push(trusted) });
    expect(decisions).toEqual([true]);
  });

  it("keeps the decision per workspace, not per agent dir", () => {
    const paths = dirs();
    createSessionTrust({ ...paths }).write(true);
    const other = createSessionTrust({ agentDir: paths.agentDir, cwd: mkdtempSync(join(tmpdir(), "cd-trust-other-")) });
    expect(other.read().decision).toBeNull();
  });
});
