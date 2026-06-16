import type { ContainerStats } from "@/env/Types";

export interface FormattedContainerStats {
  cpuPercent?: number;
  memBytes?: number;
  memLimitBytes?: number;
  memPercent?: number;
}

function finiteNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

// Docker-compat CPU% from the delta between two cpu_stats samples (current vs a prior sample).
// The prior sample is either the previous ping's cpu_stats (correct cross-ping delta) or, as a
// single-sample fallback, the same response's precpu_stats. Returns undefined unless both samples
// carry usable totals — never an inflated whole-lifetime value.
function dockerCpuPercent(current: any, prior: any): number | undefined {
  const totalUsage = finiteNumber(current?.cpu_usage?.total_usage);
  const previousTotalUsage = finiteNumber(prior?.cpu_usage?.total_usage);
  const systemUsage = finiteNumber(current?.system_cpu_usage);
  const previousSystemUsage = finiteNumber(prior?.system_cpu_usage);
  if (
    totalUsage === undefined ||
    previousTotalUsage === undefined ||
    systemUsage === undefined ||
    previousSystemUsage === undefined
  ) {
    return undefined;
  }
  const cpuDelta = totalUsage - previousTotalUsage;
  const systemDelta = systemUsage - previousSystemUsage;
  if (cpuDelta <= 0 || systemDelta <= 0) {
    return undefined;
  }
  const onlineCpus = finiteNumber(current?.online_cpus) || current?.cpu_usage?.percpu_usage?.length || 1;
  return (cpuDelta / systemDelta) * onlineCpus * 100;
}

function memoryCache(stats: any): number {
  return (
    finiteNumber(stats?.memory_stats?.stats?.total_inactive_file) ??
    finiteNumber(stats?.memory_stats?.stats?.inactive_file) ??
    finiteNumber(stats?.memory_stats?.stats?.cache) ??
    0
  );
}

export function formatContainerStats(
  stats?: ContainerStats | null,
  previous?: ContainerStats | null,
): FormattedContainerStats {
  if (!stats) {
    return {};
  }

  const directCpu = finiteNumber(stats.cpu_stats?.cpu);
  // Prefer the cross-ping delta (current vs previous sample's cpu_stats); under stream=false the
  // same response's precpu_stats is zeroed/equal, so it is only a single-sample fallback. Podman's
  // pre-computed cpu_stats.cpu is the final fallback.
  const crossSampleCpu = previous ? dockerCpuPercent(stats.cpu_stats, previous.cpu_stats) : undefined;
  const cpuPercent = crossSampleCpu ?? directCpu ?? dockerCpuPercent(stats.cpu_stats, stats.precpu_stats);
  const rawMemBytes = finiteNumber((stats as any)?.memory_stats?.usage);
  const memLimitBytes = finiteNumber((stats as any)?.memory_stats?.limit);
  const memBytes = rawMemBytes === undefined ? undefined : Math.max(0, rawMemBytes - memoryCache(stats));
  const memPercent =
    memBytes !== undefined && memLimitBytes !== undefined && memLimitBytes > 0
      ? clampPercent((memBytes / memLimitBytes) * 100)
      : undefined;

  return {
    cpuPercent: cpuPercent === undefined ? undefined : Math.max(0, cpuPercent),
    memBytes,
    memLimitBytes,
    memPercent,
  };
}
