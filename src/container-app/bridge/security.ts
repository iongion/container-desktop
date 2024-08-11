// vendors
import { v4 } from "uuid";
// project
import { findProgramPath } from "@/detector";
import { exec_launcher_async } from "@/executor";
import { createLogger } from "@/logger";
// locals
const logger = createLogger("bridge.security");

export const checkSecurity = async (api, options?: any) => {
  const report: any = {
    status: "failure",
    scanner: {
      name: options.scanner,
      path: undefined,
      version: undefined,
      database: undefined
    },
    counts: {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0
    },
    result: undefined,
    fault: undefined
  };
  try {
    const programPath = await findProgramPath(options.scanner, { osType: options.osType });
    // support only trivy for now
    if (programPath) {
      const result: any = await exec_launcher_async(programPath, ["--version"]);
      if (result.success) {
        // Scanner info
        const parsed = (result.stdout || "").split(/\r?\n/);
        const versionLines = parsed.slice(2).map((it) => it.trim());
        report.scanner = {
          name: options.scanner,
          path: programPath,
          version: parsed[0]?.split(" ")[1],
          database: versionLines.reduce((acc, it) => {
            if (!it) {
              return acc;
            }
            const [field, val] = it.split(": ");
            acc[field] = val;
            return acc;
          }, {})
        };
        // Scanner analysis
        try {
          const analysis: any = await exec_launcher_async(programPath, [
            "--quiet",
            options.subject,
            "--format",
            "json",
            options.target
          ]);
          if (analysis.success) {
            const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
            const sorter = (a, b) => {
              return priorities.indexOf(b.Severity) - priorities.indexOf(a.Severity);
            };
            try {
              const data = JSON.parse(analysis.stdout);
              data.Results = (data.Results || []).map((it) => {
                it.guid = v4();
                it.Vulnerabilities = (it.Vulnerabilities || [])
                  .map((v) => {
                    v.guid = v4();
                    if (typeof report.counts[v.Severity] === "undefined") {
                      report.counts[v.Severity] = 0;
                    }
                    report.counts[v.Severity] += 1;
                    return v;
                  })
                  .sort(sorter);
                return it;
              });
              report.result = data;
              report.status = "success";
            } catch (error: any) {
              logger.error("Error during output parsing", error.message, analysis);
              report.fault = {
                detail: "Error during output parsing",
                message: error.message
              };
            }
          } else {
            logger.error("Analysis failed", analysis);
            report.fault = {
              detail: "Analysis failed",
              message: report.stderr
            };
          }
        } catch (error: any) {
          logger.error("Error during scanning process", error.message);
          report.fault = {
            detail: "Error during scanning process",
            message: error.message
          };
        }
      }
    }
  } catch (error: any) {
    logger.error("Error during scanner detection", error.message);
    report.fault = {
      detail: "Error during scanner detection",
      message: error.message
    };
  }
  return report;
};

export function createActions(context) {
  return {
    checkSecurity: (...rest) => checkSecurity(context.getCurrentApi(), ...(rest as []))
  };
}

export default {
  checkSecurity,
  createActions
};
