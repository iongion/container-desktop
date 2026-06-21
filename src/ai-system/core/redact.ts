// Central secret redactor. Runs in main before any payload is sent to a provider and on every
// tool output before it re-enters the model. Conservative by design: redact obvious secrets
// (provider key prefixes, bearer tokens, JWTs, URL credentials, secret-looking env assignments)
// without over-redacting ordinary diagnostic text. See security model.

export const REDACTED = "[REDACTED]";

// Object keys whose VALUE should be redacted wholesale (case-insensitive). Non-global so .test() is stateless.
const SECRET_KEY_RE =
  /(pass(?:word|phrase|wd)?|secret|token|api[-_ ]?key|access[-_ ]?key|client[-_ ]?secret|authorization|credential|bearer|private[-_ ]?key)/i;

// Ordered text replacements. Each runs once over the whole string.
const TEXT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // user:password@host embedded in a URL → keep the user, redact the password.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):([^\s:@/]+)@/gi, `$1:${REDACTED}@`],
  // Authorization scheme tokens: Bearer / Basic <token>.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]+/gi, `$1 ${REDACTED}`],
  // Secret-looking UPPER_SNAKE env assignments: KEY=value → KEY=[REDACTED].
  [
    /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL|APIKEY)[A-Z0-9_]*)=("?)[^\s"]+\2/g,
    `$1=${REDACTED}`,
  ],
  // JWTs (header.payload.signature, base64url segments).
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED],
  // Known provider/token prefixes (Anthropic/OpenAI/GitHub/Slack/AWS/Stripe/Google).
  [
    /\b(sk-ant-[A-Za-z0-9._-]+|sk-[A-Za-z0-9._-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]+|AKIA[0-9A-Z]{16}|[sr]k_(?:live|test)_[A-Za-z0-9]{10,}|AIza[A-Za-z0-9_-]{20,})\b/g,
    REDACTED,
  ],
  // JSON string values under secret-looking keys — covers raw output of `cat config.json`,
  // `podman inspect`, etc., where redactPayload's key-walk doesn't apply (the output is one string).
  [
    /("(?:[\w-]*(?:password|passwd|secret|token|apikey|api[-_]?key|credential|private[-_]?key)[\w-]*)"\s*:\s*")[^"]*(")/gi,
    `$1${REDACTED}$2`,
  ],
  // Docker/Podman registry auth blob specifically (the key is exactly "auth": "<base64 user:pass>").
  [/("auth"\s*:\s*")[^"]+(")/g, `$1${REDACTED}$2`],
];

export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TEXT_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function redactValue(value: any): any {
  if (typeof value === "string") {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SECRET_KEY_RE.test(key) && val != null ? REDACTED : redactValue(val);
    }
    return out;
  }
  return value;
}

// Deep-redact an arbitrary JSON-ish payload. Returns a new value; never mutates the input.
export function redactPayload<T>(value: T): T {
  return redactValue(value) as T;
}
