import { describe, expect, it } from "vitest";
import { uniqueStrings } from "@/utils/uniqueStrings";

describe("uniqueStrings", () => {
  it("drops absent and empty values while preserving first-seen order", () => {
    expect(uniqueStrings(["worker-a", undefined, "", "worker-b", "worker-a", null])).toEqual(["worker-a", "worker-b"]);
  });
});
