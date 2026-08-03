import { describe, expect, it } from "vitest";
import { analyzeLayers } from "@/container-client/builder/analyzeLayers";
import type { ContainerImageHistory } from "@/container-client/types/image";
import { toWaterfallRows } from "./LayerInspector.logic";

const hist = (over: Partial<ContainerImageHistory>): ContainerImageHistory => ({
  id: "sha256:x",
  created: "t",
  Created: "t",
  CreatedBy: "RUN x",
  Size: 0,
  Comment: "",
  ...over,
});

describe("toWaterfallRows", () => {
  it("returns one row per layer with the largest at 100% and empties at 0%", () => {
    const history = [
      hist({ CreatedBy: "FROM alpine", Size: 5_000_000 }),
      hist({ CreatedBy: "COPY . .", Size: 57_000_000 }),
      hist({ CreatedBy: "RUN npm ci", Size: 8_000_000 }),
      hist({ CreatedBy: "CMD", Size: 0 }),
    ];
    const rows = toWaterfallRows(analyzeLayers(history));
    expect(rows.length).toBe(4);
    expect(rows.find((row) => row.createdBy === "COPY . .")?.percent).toBe(100);
    expect(rows.find((row) => row.createdBy === "CMD")?.percent).toBe(0);
    expect(rows.find((row) => row.createdBy === "CMD")?.empty).toBe(true);
  });

  it("surfaces a large-layer finding for a dominant layer", () => {
    const analysis = analyzeLayers([
      hist({ CreatedBy: "FROM", Size: 5_000_000 }),
      hist({ CreatedBy: "COPY", Size: 60_000_000 }),
    ]);
    expect(analysis.findings.some((finding) => finding.kind === "large-layer")).toBe(true);
  });
});
