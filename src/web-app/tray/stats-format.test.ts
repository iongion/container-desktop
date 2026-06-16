import { describe, expect, it } from "vitest";

import type { ContainerStats } from "@/env/Types";
import { formatContainerStats } from "./stats-format";

describe("formatContainerStats", () => {
  it("computes Docker CPU percentage from usage deltas", () => {
    const stats = {
      cpu_stats: {
        cpu_usage: { total_usage: 1500, percpu_usage: [700, 800] },
        system_cpu_usage: 10000,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 1000 },
        system_cpu_usage: 5000,
      },
      memory_stats: { usage: 0, limit: 0 },
    } as unknown as ContainerStats;

    expect(formatContainerStats(stats).cpuPercent).toBe(20);
  });

  it("falls back to Podman direct CPU percentage when deltas are absent", () => {
    const stats = {
      cpu_stats: { cpu: 7.5 },
      precpu_stats: {},
      memory_stats: { usage: 0, limit: 0 },
    } as unknown as ContainerStats;

    expect(formatContainerStats(stats).cpuPercent).toBe(7.5);
  });

  it("subtracts memory cache and reports memory percentage", () => {
    const stats = {
      cpu_stats: {},
      precpu_stats: {},
      memory_stats: {
        usage: 1200,
        limit: 2000,
        stats: { total_inactive_file: 200 },
      },
    } as unknown as ContainerStats;

    expect(formatContainerStats(stats)).toMatchObject({
      memBytes: 1000,
      memLimitBytes: 2000,
      memPercent: 50,
    });
  });
});
