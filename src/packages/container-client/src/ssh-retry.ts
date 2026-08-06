// An `ssh` that never got as far as running the command.
//
// A remote's sshd refuses connections under a burst. Measured on a Windows remote: of 14 concurrent engine commands,
// one came back `kex_exchange_identification: read: Connection reset by peer` — the other thirteen succeeded. That is
// not the engine's answer and not the command's: the session was never established, so the command never ran and
// running it again cannot repeat anything. The app used to hand that raw error to whoever asked, which on the AI
// session's path read as the session failing.
//
// Everything else is an ANSWER — a real engine error, a missing image, a name already in use — and is never retried
// here. Nor is a timed-out or unreachable host: that one fails slowly, so retrying it would multiply a wait rather
// than recover from a burst.

const NEVER_CONNECTED = [
  // OpenSSH's own words for a peer that dropped us during the handshake, which is what a burst produces.
  /kex_exchange_identification/i,
  /error in libcrypto/i,
  /connection reset by/i,
  /connection closed by remote host/i,
  /banner exchange/i,
];

export const SSH_RETRY_ATTEMPTS = 3;
export const SSH_RETRY_DELAY_MS = 400;

export function sshNeverConnected(output: string | null | undefined): boolean {
  const text = `${output ?? ""}`;
  if (!text.trim()) return false;
  return NEVER_CONNECTED.some((pattern) => pattern.test(text));
}
