import { createWebviewAISystemHost, type WebviewAISystemHost } from "@/platform/webviewAISystemHost";
import { type AISystemDeps, createAISystem } from "./aiSystem";

export type AISystemHostDeps = Pick<
  AISystemDeps,
  | "invoke"
  | "fs"
  | "path"
  | "userDataDir"
  | "getAISettings"
  | "engineOps"
  | "connectionExec"
  | "mock"
  | "logger"
  | "newPublicWebFetchChannel"
>;

export function createAISystemHost(deps: AISystemHostDeps): Promise<WebviewAISystemHost> {
  return createWebviewAISystemHost((transport) => createAISystem({ ...deps, ...transport }));
}
