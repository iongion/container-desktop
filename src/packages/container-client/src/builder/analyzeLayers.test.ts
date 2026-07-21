import { describe, expect, it } from "vitest";
import type { ContainerImageHistory } from "@/container-client/types/image";
import { analyzeLayers } from "./analyzeLayers";

const hist = (over: Partial<ContainerImageHistory>): ContainerImageHistory => ({
  id: "sha256:x",
  created: "t",
  Created: "t",
  CreatedBy: "RUN x",
  Size: 0,
  Comment: "",
  ...over,
});

describe("analyzeLayers", () => {
  it("computes cumulative sizes, total, top-N largest and a large-layer finding", () => {
    const history = [
      hist({ CreatedBy: "FROM alpine", Size: 5_000_000 }),
      hist({ CreatedBy: "COPY . .", Size: 57_000_000 }),
      hist({ CreatedBy: "RUN npm ci", Size: 8_000_000 }),
      hist({ CreatedBy: "CMD [...]", Size: 0 }),
    ];
    const result = analyzeLayers(history);
    expect(result.totalSize).toBe(70_000_000);
    expect(result.layers[3].cumulativeSize).toBe(70_000_000);
    expect(result.layers[3].empty).toBe(true);
    expect(result.largest[0].size).toBe(57_000_000);
    expect(result.findings.some((f) => f.kind === "large-layer")).toBe(true);
  });
});
