// vendors
const { v4 } = require("uuid");
// project
const { createLogger } = require("@podman-desktop-companion/logger");
const { findProgramPath } = require("@podman-desktop-companion/detector");
const { exec_launcher_async } = require("@podman-desktop-companion/executor");
// locals
const logger = createLogger("bridge.security");

const checkSecurity = async (api, options) => {
  const report = {
    status: "failure",
    scanner: {
      name: options.scanner,
      path: undefined,
      version: undefined,
      database: undefined
    },
    counts: {
      Critical: 0,
      High: 0,
      Medium: 0,
      Low: 0
    },
    result: undefined,
    fault: undefined
  };
  try {
    const programPath = await findProgramPath(options.scanner, { osType: options.osType });
    // support only trivy for now
    if (programPath) {
      const result = await exec_launcher_async(programPath, ["--version"]);
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
          const analysis = await exec_launcher_async(programPath, [
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
              let data = JSON.parse(analysis.stdout);
              data.Results = data.Results.map((it) => {
                it.guid = v4();
                it.Vulnerabilities = it.Vulnerabilities.map((v) => {
                  v.guid = v4();
                  if (typeof report.counts[v.Severity] === "undefined") {
                    report.counts[v.Severity] = 0;
                  }
                  report.counts[v.Severity] += 1;
                  return v;
                }).sort(sorter);
                return it;
              });
              report.result = data;
              report.status = "success";
            } catch (error) {
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
        } catch (error) {
          logger.error("Error during scanning process", error.message);
          report.fault = {
            detail: "Error during scanning process",
            message: error.message
          };
        }
      }
    }
  } catch (error) {
    logger.error("Error during scanner detection", error.message);
    report.fault = {
      detail: "Error during scanner detection",
      message: error.message
    };
  }
  return report;
};

function createActions(context) {
  return {
    checkSecurity: (...rest) => checkSecurity(context.getCurrentApi(), ...rest)
  };
}

module.exports = {
  checkSecurity,
  createActions
};
