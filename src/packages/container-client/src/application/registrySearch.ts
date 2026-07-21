import type { Registry, RegistrySearchFilters } from "@/container-client/types/registry";

// State-free helpers for searchRegistry. Lifted verbatim from Application.ts — the orchestration
// (host calls, per-engine branching) stays in the method; only the arg/param/output shaping lives here.

// normalizeAndSortSearchResults intentionally mutates its items (defaulting Stars) before sorting —
// that side effect is preserved from the original; do not "clean up" into a pure copy.
export const normalizeAndSortSearchResults = (items: any[]) => {
  let output = items.map((it) => {
    if (typeof it.Stars === "undefined") {
      it.Stars = 0;
      if (typeof it.StarCount !== "undefined") {
        it.Stars = Number(it.StarCount);
      }
    }
    return it;
  });
  // 1st sort by name
  output = output.sort((a, b) => {
    return a.Name.localeCompare(b.Name, "en", { numeric: true });
  });
  // 2nd sort by stars
  output = output.sort((a, b) => {
    return b.Stars - a.Stars;
  });
  return output;
};

// API image-search query (Podman system registry + Apple socktainer). Insertion order is significant —
// it determines the resulting URL string. Apple never sends is-automated, hence `includeAutomated`.
export function buildImageSearchParams(
  term: string,
  filters: RegistrySearchFilters | undefined,
  opts: { includeAutomated: boolean },
): URLSearchParams {
  const searchParams = new URLSearchParams();
  searchParams.set("term", term || "");
  if (opts.includeAutomated && filters?.isAutomated) {
    searchParams.set("is-automated", "true");
  }
  if (filters?.isOfficial) {
    searchParams.set("is-official", "true");
  }
  return searchParams;
}

// Podman CLI search args: `search [--filter=is-official] [--filter=is-automated] <registry>/<term> --format json`.
export function buildPodmanSearchArgs(
  registry: Registry,
  term: string,
  filters: RegistrySearchFilters | undefined,
): string[] {
  const filtersList: string[] = [];
  if (filters?.isOfficial) {
    filtersList.push("--filter=is-official");
  }
  if (filters?.isAutomated) {
    filtersList.push("--filter=is-automated");
  }
  return ["search", ...filtersList, `${registry.name}/${term}`, "--format", "json"];
}

// Docker CLI search args: `search --format json [--filter is-official=true] <term>`.
export function buildDockerSearchArgs(term: string, filters: RegistrySearchFilters | undefined): string[] {
  const args = ["search", "--format", "json"];
  if (filters?.isOfficial) {
    args.push("--filter", "is-official=true");
  }
  args.push(term);
  return args;
}

// Docker emits multiple JSON lines rather than a JSON array — wrap them into one parseable array.
// Other engines return their stdout as-is. Returns the string to JSON.parse (caller keeps the empty guard).
export function normalizeSearchOutput(stdout: string | undefined, isDocker: boolean): string | undefined {
  return isDocker ? `[${(stdout || "").trim().split(/\r?\n/).join(",")}]` : stdout;
}
