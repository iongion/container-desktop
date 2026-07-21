import { fetch as undiciFetch } from "undici";

import type { ProviderTransport } from "@/ai-system/core/types";
import type { IKeychain } from "@/host-contract/capabilities";
import { createFetchProviderTransport } from "@/platform/providerTransport/fetchProviderTransport";

export interface ElectronProviderTransportDeps {
  keychain: IKeychain;
  fetchImpl?: typeof fetch;
}

export function createElectronProviderTransport(deps: ElectronProviderTransportDeps): ProviderTransport {
  return createFetchProviderTransport({
    keychain: deps.keychain,
    fetchImpl: deps.fetchImpl ?? (undiciFetch as unknown as typeof fetch),
  });
}
