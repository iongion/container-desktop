import { extractApiErrorText } from "@/utils/apiError";

// Build a human-useful toast/notification message for a failed TanStack Query. The bare "Error fetching
// data" label says nothing in the Notification Center, so we append the failing resource (the queryKey's
// leading segment, e.g. "registries"/"images") and the underlying error text — what failed, and why.
// The detail is pulled via the shared engine-aware normalizer so the engine's own body message wins over
// axios's generic "Request failed with status code NNN".
export function formatQueryErrorMessage(base: string, error: unknown, queryKey?: unknown): string {
  const resource = Array.isArray(queryKey) && typeof queryKey[0] === "string" ? queryKey[0] : undefined;
  const detail = extractApiErrorText(error, "").trim();
  const head = resource ? `${base} (${resource})` : base;
  return detail ? `${head}: ${detail}` : head;
}
