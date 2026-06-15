import { describe, expect, it } from "vitest";

import { describeLogStatus } from "./LiveLogBadge";

describe("describeLogStatus", () => {
  it("maps live to a pulsing LIVE pill", () => {
    expect(describeLogStatus("live")).toEqual({ label: "LIVE", tone: "live", pulsing: true });
  });
  it("maps connecting to a pulsing CONNECTING pill", () => {
    expect(describeLogStatus("connecting")).toEqual({ label: "CONNECTING", tone: "connecting", pulsing: true });
  });
  it("maps ended to a static ENDED pill", () => {
    expect(describeLogStatus("ended")).toEqual({ label: "ENDED", tone: "ended", pulsing: false });
  });
  it("maps error to a static ERROR pill", () => {
    expect(describeLogStatus("error")).toEqual({ label: "ERROR", tone: "error", pulsing: false });
  });
  it("maps snapshot to a static SNAPSHOT pill", () => {
    expect(describeLogStatus("snapshot")).toEqual({ label: "SNAPSHOT", tone: "snapshot", pulsing: false });
  });
});
