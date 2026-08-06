// What a liveness ping is allowed to conclude from ONE unanswered request.
//
// A native engine answers on a local socket in single-digit milliseconds. A SCOPED one answers across whatever the
// connection crosses: for an SSH remote whose engine lives in a machine, that is the outer SSH hop, a nested one into
// the machine, and a unix socket at the end of it — measured at about 1.1s on an idle machine, and the same under load.
// A single 3s attempt is a coin toss against that, and losing it used to cost the user the whole connection, because
// the caller stops the API and an SSH transport's `stopApi` closes the ssh client every engine command travels on. So a
// scoped connection gets room for its bridge, and one unanswered ping is a hiccup rather than a verdict.

export interface ApiPingOutcome {
  success: boolean;
  details: string;
}

export interface ApiPingPolicy {
  attempts: number;
  timeoutMs: number;
  delayMs: number;
}

const NATIVE_TIMEOUT_MS = 3000;
// Three bridges' worth of headroom over the measured 1.1s, so a slow VM wake or a remote sshd briefly refusing new
// connections reads as slow rather than absent.
const SCOPED_TIMEOUT_MS = 10000;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export function apiPingPolicy(isScoped: boolean): ApiPingPolicy {
  return {
    attempts: ATTEMPTS,
    timeoutMs: isScoped ? SCOPED_TIMEOUT_MS : NATIVE_TIMEOUT_MS,
    delayMs: RETRY_DELAY_MS,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The last attempt's answer is the one reported: it is the most recent thing the engine did or did not say, and the
// caller's reason string is what the user is shown.
export async function pingUntilAnswered(
  attempt: (timeoutMs: number) => Promise<ApiPingOutcome>,
  policy: ApiPingPolicy,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<ApiPingOutcome> {
  let last: ApiPingOutcome = { success: false, details: "API was never asked" };
  for (let index = 1; index <= policy.attempts; index += 1) {
    last = await attempt(policy.timeoutMs);
    if (last.success) return last;
    if (index < policy.attempts) await wait(policy.delayMs);
  }
  return last;
}
