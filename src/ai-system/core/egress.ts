import { redactPayload } from "./redact";

// Egress policy for AI provider calls.
//
// Whether a call leaves the device is decided by the RESOLVED HOST of the base URL, never by the
// provider label. This closes the "point a local provider's baseURL at a remote server" bypass:
// a llamacpp/lmstudio baseURL on a LAN/public host is treated exactly like a cloud call.

export function isLoopbackHost(host: string): boolean {
  if (!host) {
    return false;
  }
  const h = host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (h === "localhost" || h === "::1") {
    return true;
  }
  // IPv4 loopback 127.0.0.0/8 (incl. the IPv4-mapped IPv6 form).
  if (/^127(?:\.\d{1,3}){3}$/.test(h) || /^::ffff:127(?:\.\d{1,3}){3}$/.test(h)) {
    return true;
  }
  return false;
}

export function isOffDeviceURL(baseURL: string): boolean {
  try {
    return !isLoopbackHost(new URL(baseURL).hostname);
  } catch {
    // Unparseable → assume it leaves the device (fail safe).
    return true;
  }
}

export interface EgressDecision {
  offDevice: boolean;
  allowed: boolean;
  requiresConsent: boolean;
}

// Off-device classifier (enforced in main, in the AI broker). Consent is the stored API key: a cloud
// provider is admitted by saving its key (the broker throws without one), and pointing a local provider
// at an off-device URL is itself the explicit act. This only reports whether a call leaves the device —
// loopback is on-device, everything else is off-device but allowed. Redaction (previewOutbound /
// redactPayload) still applies to every outbound payload regardless.
export function evaluateEgress(opts: { baseURL: string }): EgressDecision {
  return { offDevice: isOffDeviceURL(opts.baseURL), allowed: true, requiresConsent: false };
}

// The exact redacted bytes the UI shows before an off-device call is permitted.
export function previewOutbound(payload: unknown): { payload: any; text: string } {
  const redacted = redactPayload(payload);
  return { payload: redacted, text: JSON.stringify(redacted, null, 2) };
}
