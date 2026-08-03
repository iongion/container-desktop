// Extract the richest human-readable message from any thrown value, so a real upstream failure always reaches the
// user instead of a generic wrapper. Dependency-free (pure core): no AI-SDK, node, or provider imports — it
// duck-types the shapes those layers throw.
//
// It handles the three ways a good message gets lost:
//   1. Provider errors (AI-SDK APICallError, OpenRouter) carry the real text in a `responseBody`/`data` body —
//      e.g. `{ error: { message: "Upstream error from Nvidia: ResourceExhausted…" } }` — while `.message` is a
//      generic summary. We prefer the body.
//   2. A `fetch failed` TypeError hides the real reason in `.cause` (e.g. `connect ECONNREFUSED 127.0.0.1:1234`).
//      We walk the cause chain and append it.
//   3. A non-Error value stringifies to "[object Object]". We fall back to bounded JSON, never that.

const MAX_MESSAGE_CHARS = 2_000;

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// Pull a message out of a provider error body, which may be a parsed object or a raw JSON string.
function messageFromBody(body: unknown): string | undefined {
  let parsed = body;
  if (typeof body === "string") {
    const text = body.trim();
    if (!text) return undefined;
    try {
      parsed = JSON.parse(text);
    } catch {
      // A non-JSON body (plain-text error page) is still better than nothing.
      return text.slice(0, MAX_MESSAGE_CHARS);
    }
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as { error?: unknown; message?: unknown };
    const nested = record.error as { message?: unknown } | string | undefined;
    return cleanString(typeof nested === "object" ? nested?.message : nested) ?? cleanString(record.message);
  }
  return undefined;
}

export function describeError(error: unknown, depth = 0): string {
  if (error == null) return "Unknown error";
  if (typeof error === "string") return cleanString(error) ?? "Unknown error";
  if (typeof error !== "object") return String(error);

  const record = error as {
    message?: unknown;
    error?: unknown;
    responseBody?: unknown;
    data?: unknown;
    cause?: unknown;
  };
  const nestedError =
    depth < 4 && record.error != null && record.error !== error ? describeError(record.error, depth + 1) : undefined;

  // The richest source first: a provider response body, then a nested error.message, then the plain message.
  const base =
    messageFromBody(record.responseBody) ??
    messageFromBody(record.data) ??
    (nestedError !== "Unknown error" ? nestedError : undefined) ??
    cleanString(record.message);

  // Walk the cause chain so "fetch failed" surfaces its real reason. Depth-bounded, and never revisits itself.
  const cause =
    depth < 4 && record.cause != null && record.cause !== error ? describeError(record.cause, depth + 1) : undefined;

  let result = base;
  if (base && cause && cause !== "Unknown error" && !base.includes(cause)) result = `${base}: ${cause}`;
  else if (!base && cause && cause !== "Unknown error") result = cause;

  if (result) return result.slice(0, MAX_MESSAGE_CHARS);

  // Last resort — never "[object Object]".
  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}" && json !== "null") return json.slice(0, MAX_MESSAGE_CHARS);
  } catch {
    // fall through
  }
  return "Unknown error";
}
