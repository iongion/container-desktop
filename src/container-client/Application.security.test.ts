import { describe, expect, it, vi } from "vitest";

import { Application } from "@/container-client/Application";
import { ContainerEngineHost, OperatingSystem } from "@/env/Types";

// searchRegistry/checkSecurity log immediately; the constructor leaves `this.logger` unset (set in setup()).
const STUB_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };

function makeApp(): any {
  const app = new Application({
    osType: OperatingSystem.Linux,
    version: "test",
    environment: "test",
    messageBus: {} as any,
  }) as any;
  app.logger = STUB_LOGGER;
  return app;
}

// Fake host whose runHostCommand/runScopeCommand dispatch by whether it's the `--version` probe.
function hostFor(opts: {
  scoped?: boolean;
  host?: ContainerEngineHost;
  versionStdout?: string;
  versionSuccess?: boolean;
  analysisStdout?: string;
  analysisSuccess?: boolean;
}): any {
  const program = { name: "trivy", path: "/usr/bin/trivy", version: "0.50" };
  const run = async (_program: string, args: string[]) => {
    if (args.includes("--version")) {
      return { success: opts.versionSuccess ?? true, stdout: opts.versionStdout ?? "{}" };
    }
    return { success: opts.analysisSuccess ?? true, stdout: opts.analysisStdout ?? "null" };
  };
  return {
    HOST: opts.host ?? ContainerEngineHost.PODMAN_NATIVE,
    isScoped: () => opts.scoped ?? false,
    getSettings: async () => ({ controller: { scope: "wsl" } }),
    findHostProgram: async () => program,
    findScopeProgram: async () => program,
    runHostCommand: run,
    runScopeCommand: (program2: string, args: string[]) => run(program2, args),
  };
}

describe("Application.checkSecurity", () => {
  it("trivy success: counts by severity, db version, sorted vulns with guids", async () => {
    const app = makeApp();
    const host = hostFor({
      versionStdout: JSON.stringify({ Version: "db-123" }),
      analysisStdout: JSON.stringify({
        Results: [
          { Target: "t", Vulnerabilities: [{ Severity: "HIGH" }, { Severity: "CRITICAL" }, { Severity: "LOW" }] },
        ],
      }),
    });

    const report = await app.checkSecurity({ scanner: "trivy", subject: "image", target: "nginx:latest", host });

    expect(report.status).toBe("success");
    expect(report.scanner.version).toBe("db-123");
    expect(report.counts).toMatchObject({ CRITICAL: 1, HIGH: 1, LOW: 1 });
    expect(typeof report.result.Results[0].guid).toBe("string");
    expect(report.result.Results[0].Vulnerabilities.map((v: any) => v.Severity)).toEqual(["CRITICAL", "HIGH", "LOW"]);
  });

  it("bad db-version JSON: logs, retains the program version, scan continues", async () => {
    const app = makeApp();
    const errSpy = vi.spyOn(app.logger, "error").mockImplementation(() => {});
    const host = hostFor({ versionStdout: "not-json", analysisStdout: JSON.stringify({ Results: [] }) });

    const report = await app.checkSecurity({ scanner: "trivy", subject: "image", target: "nginx", host });

    expect(errSpy).toHaveBeenCalled();
    expect(report.scanner.version).toBe("0.50"); // fell back to the program version
    expect(report.status).toBe("success");
    errSpy.mockRestore();
  });

  it("bad analysis JSON: sets the parsing fault and stays failure", async () => {
    const app = makeApp();
    const host = hostFor({ versionStdout: "{}", analysisStdout: "not-json" });

    const report = await app.checkSecurity({ scanner: "trivy", subject: "image", target: "nginx", host });

    expect(report.status).toBe("failure");
    expect(report.fault?.detail).toBe("Error during output parsing");
  });

  it("vendor host: skips the scope even when scoped", async () => {
    const app = makeApp();
    let scopeProgramCalled = false;
    let hostProgramCalled = false;
    const host = hostFor({
      host: ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
      scoped: true,
      analysisStdout: JSON.stringify({ Results: [] }),
    });
    host.findScopeProgram = async () => {
      scopeProgramCalled = true;
      return { name: "trivy", path: "/t", version: "1" };
    };
    host.findHostProgram = async () => {
      hostProgramCalled = true;
      return { name: "trivy", path: "/t", version: "1" };
    };

    await app.checkSecurity({ scanner: "trivy", subject: "image", target: "nginx", host });

    expect(hostProgramCalled).toBe(true);
    expect(scopeProgramCalled).toBe(false);
  });
});
