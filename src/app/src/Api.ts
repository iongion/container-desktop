// vendors
// project
import {
  Environments
  // Domain
} from "./Types";

import { API } from "./Environment";
import { IContainerClient, BrowserContainerClient, NativeContainerClient } from "./Api.clients";

import { Native, Platforms } from "./Native";

const APIRegistry: Partial<{ [key in Environments]: IContainerClient }> = {};

export function findAPI(env: Environments): IContainerClient {
  if (!(env in APIRegistry)) {
    if (Native.getInstance().getPlatform() === Platforms.Browser) {
      APIRegistry[env] = new BrowserContainerClient({ baseURL: API });
    } else {
      const opts = Native.getInstance().getContainerApiConfig();
      APIRegistry[env] = new NativeContainerClient(opts);
    }
  }
  const client = APIRegistry[env];
  if (typeof client === "undefined") {
    throw new Error("Unable to access client for this env");
  }
  return client;
}
