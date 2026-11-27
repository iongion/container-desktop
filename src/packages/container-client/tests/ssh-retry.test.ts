import { describe, expect, it } from "vitest";

import { sshNeverConnected } from "@/container-client/ssh-retry";

// Which failures mean the command never ran. Measured on a Windows remote: of 14 concurrent engine commands one was
// refused mid-handshake while the other thirteen succeeded, so a burst — the app's own polling plus a session's
// commands plus the API bridge — can lose one for a reason that has nothing to do with what was asked.

describe("sshNeverConnected", () => {
  it("recognises a peer that dropped us during the handshake", () => {
    expect(sshNeverConnected("kex_exchange_identification: read: Connection reset by peer")).toBe(true);
    expect(sshNeverConnected("Connection reset by 192.168.122.5 port 22")).toBe(true);
    expect(sshNeverConnected("Connection closed by remote host")).toBe(true);
    expect(sshNeverConnected("Bad packet length / banner exchange")).toBe(true);
  });

  // An ANSWER, however unwelcome. Retrying one of these would repeat work the engine already did — the reason this
  // predicate is a whitelist of transport failures rather than "anything that failed".
  it("leaves the engine's own errors alone", () => {
    expect(sshNeverConnected("Error: no such container: cd-agent-1")).toBe(false);
    expect(sshNeverConnected('Error: creating container storage: the container name "x" is already in use')).toBe(
      false,
    );
    expect(sshNeverConnected("Error: unable to find image locally")).toBe(false);
  });

  // A host that is off or firewalled fails SLOWLY, so retrying multiplies a wait instead of recovering from a burst.
  it("does not treat an unreachable host as a burst", () => {
    expect(sshNeverConnected("ssh: connect to host win11 port 22: Connection timed out")).toBe(false);
    expect(sshNeverConnected("ssh: connect to host win11 port 22: No route to host")).toBe(false);
  });

  it("says nothing about an empty answer", () => {
    expect(sshNeverConnected("")).toBe(false);
    expect(sshNeverConnected(undefined)).toBe(false);
    expect(sshNeverConnected(null)).toBe(false);
  });

  // The warning a post-quantum-less server prints on EVERY connection here lands on the same stream, so a naive
  // "does stderr mention a connection" would retry every successful command in the app.
  it("is not fooled by the post-quantum warning every connection carries", () => {
    expect(
      sshNeverConnected(
        '** WARNING: connection is not using a post-quantum key exchange algorithm.\n** This session may be vulnerable to "store now, decrypt later" attacks.',
      ),
    ).toBe(false);
  });
});
