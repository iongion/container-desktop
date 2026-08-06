// Making a port published on ANOTHER machine answer on this one.
//
// A container publishes on the loopback of the machine running the ENGINE. For a local engine that is this machine and
// the app dials it directly; for a remote (SSH) connection it is somewhere else entirely, so a local `ssh -NL` forward
// is opened and the local end is dialled instead. Everything after that point is identical either way.
//
// Three callers need exactly this, on three different sockets — the assistant's bridge, its conversation store, and a
// provider sign-in's bridge — which is why it is one function rather than each store growing its own. Deliberately NOT
// the engine's data plane: that one is the native proxy and request-shaped, while these are WebSocket upgrades over
// long-lived sockets.

import { type BridgeTunnel, openBridgeTunnel } from "@/ai-system/adapters/bridgeTunnel";
import { pickHostPort } from "@/ai-system/adapters/piAgentContainer";
import { getAvailableSSHConnections } from "@/container-client/shared";
import { credentialsFromSSHHost } from "@/container-client/ssh-args";
import { OperatingSystem } from "@/container-client/types/os";
import { useAppStore } from "@/web-app/stores/appStore";

export interface RemoteReachRequest {
  // The connection's own scope — the `~/.ssh/config` entry its engine is reached through. Requiring one is the app's
  // existing contract, not a new one: resolving a remote's credentials goes through the same list everywhere else.
  scope?: string;
  // What cannot be reached when no entry matches, in the words the refusal reads with ("its bridge").
  what: string;
  // What this forward carries, in the words the forward's own failures read with ("the assistant's bridge"). A pair
  // has more than one socket reached this way, and a reason naming the wrong one sends the reader to the wrong place.
  label: string;
  // The port as published on the remote, and where it answers as reached FROM there: the remote's own loopback by
  // default, or the machine's address for an engine whose containers live inside one.
  remotePort: number;
  remoteHost?: string;
  // Called when the forward dies. Every frame after that goes nowhere, so the caller says so rather than leaving a
  // socket that has quietly stopped carrying anything.
  onLost: (reason: string) => void;
}

export async function forwardPublishedPort(request: RemoteReachRequest): Promise<BridgeTunnel> {
  const entry = (await getAvailableSSHConnections()).find(
    (host) => host.Name === request.scope || host.ConfigHost === request.scope || host.Host === request.scope,
  );
  if (!entry) {
    throw new Error(
      `no SSH host in your config matches ${request.scope || "this connection"}, so ${request.what} cannot be reached`,
    );
  }
  return await openBridgeTunnel(
    {
      spawn: (launcher, args) => Command.ExecuteStreaming(launcher, args),
      localPort: pickHostPort(),
      // The OS the app is running ON, from the same place every screen reads it. Windows ships OpenSSH as `ssh.exe`,
      // and a spawn is not a shell, so the name has to be exact.
      launcher: useAppStore.getState().osType === OperatingSystem.Windows ? "ssh.exe" : "ssh",
    },
    {
      credentials: credentialsFromSSHHost(entry),
      remotePort: request.remotePort,
      onLost: request.onLost,
      label: request.label,
      remoteHost: request.remoteHost,
    },
  );
}
