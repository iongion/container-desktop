// Engine-agnostic extraction of a human-readable message from a failed engine API call.
//
// Container engines do NOT agree on the error-body shape: Docker / Apple return `{ message }`, Podman/libpod
// return `{ cause, message, response }`, and a few endpoints answer with `{ Err }` / `{ error }` or a bare
// string. On top of that, axios only ever sets the generic `"Request failed with status code NNN"` as the
// Error `message`. This pulls the richest available text out of an axios-like error, always preferring the
// engine's own body over the generic axios string, so the same helper feeds every user-facing surface
// (toasts, the Notification Center, the Activity panel).

export function extractApiErrorText(error: unknown, fallback = "Request failed"): string {
  const err = error as any;
  const data = err?.response?.data;
  const candidates = [
    typeof data === "string" ? data : undefined, // plain-text body
    data?.message, // Docker / Apple, and libpod's rich text
    data?.cause, // libpod short cause
    data?.Err, // some daemon/volume errors
    data?.error, // misc endpoints
    data?.error?.message, // nested { error: { message } }
    err?.response?.statusText, // HTTP reason phrase
    typeof err?.message === "string" ? err.message : typeof err === "string" ? err : undefined, // axios generic, last resort
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return fallback;
}

/** The HTTP status behind an axios-like error, coerced to a number — survives the string-ified IPC re-serialize. */
export function apiErrorStatus(error: unknown): number | undefined {
  const err = error as any;
  const raw = err?.response?.status ?? err?.status;
  const status = Number(raw);
  return Number.isFinite(status) && status > 0 ? status : undefined;
}
