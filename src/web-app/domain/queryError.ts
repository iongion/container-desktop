// Build a human-useful toast/notification message for a failed TanStack Query. The bare "Error fetching
// data" label says nothing in the Notification Center, so we append the failing resource (the queryKey's
// leading segment, e.g. "registries"/"images") and the underlying error text — what failed, and why.
export function formatQueryErrorMessage(base: string, error: unknown, queryKey?: unknown): string {
  const resource = Array.isArray(queryKey) && typeof queryKey[0] === "string" ? queryKey[0] : undefined;
  const detail = (error instanceof Error ? error.message : String(error ?? "")).trim();
  const head = resource ? `${base} (${resource})` : base;
  return detail ? `${head}: ${detail}` : head;
}
