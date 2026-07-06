import { afterEach, describe, expect, it } from "vitest";
import { setEngineProxyEnv } from "@/platform/proxy-env-policy";
import { processSpawnPayload } from "./process-utils";

describe("processSpawnPayload", () => {
  afterEach(() => setEngineProxyEnv());

  it("keeps generic subprocesses off engine proxy env unless explicitly opted in", () => {
    setEngineProxyEnv({ HTTPS_PROXY: "http://proxy.example.com:8080" });
    expect(processSpawnPayload("podman", ["ps"], {}).env).toBeUndefined();
  });

  it("merges engine proxy env for opted-in subprocesses", () => {
    setEngineProxyEnv({ HTTPS_PROXY: "http://proxy.example.com:8080" });
    expect(processSpawnPayload("podman", ["pull"], { proxyEnv: true, env: { EXTRA: "1" } }).env).toEqual({
      HTTPS_PROXY: "http://proxy.example.com:8080",
      EXTRA: "1",
    });
  });
});
