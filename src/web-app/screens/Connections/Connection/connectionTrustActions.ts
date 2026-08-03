// Engine-side projection of a connection's trust settings, run AFTER the connection's settings are persisted
// (create/updateConnection). It installs/removes CAs in certs.d, writes registries.conf / daemon.json, and
// injects the guest proxy drop-in. Best-effort by design: a not-yet-connected engine has no resolvable host,
// so projection is deferred to connect time (the writers are idempotent). It NEVER throws — a projection
// failure must not fail the form save; each write is caught and logged.

import { Application } from "@/container-client/Application";
import { resolveConnectionProxy } from "@/container-client/registryTrust/proxyResolution";
import type { EngineConnectorSettings } from "@/container-client/types/connection";
import type { ProxyConfig } from "@/container-client/types/network";
import { createLogger } from "@/logger";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { diffCertificates, removedRegistryLocations } from "./connectionTrust";

const logger = createLogger("web.connections.trust");

export async function saveConnectionTrust(
  connectionId: string,
  prev: EngineConnectorSettings | undefined,
  next: EngineConnectorSettings | undefined,
  globalProxy: Partial<ProxyConfig> | undefined,
): Promise<void> {
  try {
    const host = await resolveConnectionHost(connectionId);
    if (!host) {
      // Not connected / unknown — settings are persisted; the projection lands when the engine connects.
      return;
    }
    const app = Application.getInstance();

    // Certificates: install the added ones (need a PEM + host), remove the deleted ones.
    const { added, removed } = diffCertificates(prev?.certificates, next?.certificates);
    for (const ca of added) {
      if (ca.pem && ca.host) {
        await app.importCA({ host, registryHost: ca.host, pem: ca.pem }).catch((error: any) => {
          logger.error("importCA failed", ca.host, error);
        });
      }
    }
    for (const ca of removed) {
      if (ca.host) {
        await app.removeCA({ host, registryHost: ca.host }).catch((error: any) => {
          logger.error("removeCA failed", ca.host, error);
        });
      }
    }

    // Registries: project the managed set; removedLocations deletes ONLY entries the user dropped.
    const registries = next?.registries ?? [];
    const removedLocations = removedRegistryLocations(prev?.registries, next?.registries);
    if (registries.length > 0 || removedLocations.length > 0) {
      await app.writeRegistryConfig({ host, registries, removedLocations }).catch((error: any) => {
        logger.error("writeRegistryConfig failed", error);
      });
    }

    // Proxy: inject the effective proxy into a scoped guest (applyProxyToGuest no-ops on native hosts, which
    // already inherit the app's proxy env). Only when the connection overrides/disables the global proxy.
    const proxy = next?.proxy;
    if (proxy && proxy.mode !== "inherit") {
      const config = resolveConnectionProxy(globalProxy, proxy);
      await app.applyProxyToGuest({ host, config }).catch((error: any) => {
        logger.error("applyProxyToGuest failed", error);
      });
    }
  } catch (error: any) {
    logger.error("saveConnectionTrust failed", connectionId, error);
  }
}
