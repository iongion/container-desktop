// Containerfile linter. Pure: AST in, findings out. Rules are intentionally small and independent so the
// editor can squiggle each one and the config/timeline can surface the cache-related ones. CF007 is the
// headline cache rule — copying the whole context before installing dependencies is the most common reason
// a build stops caching.

import type { CfInstruction, ContainerfileAst, LintFinding } from "../types";

const KNOWN_INSTRUCTIONS = new Set([
  "FROM",
  "RUN",
  "CMD",
  "LABEL",
  "MAINTAINER",
  "EXPOSE",
  "ENV",
  "ADD",
  "COPY",
  "ENTRYPOINT",
  "VOLUME",
  "USER",
  "WORKDIR",
  "ARG",
  "ONBUILD",
  "STOPSIGNAL",
  "HEALTHCHECK",
  "SHELL",
]);

const INSTALL_RE =
  /\b(npm (ci|install|i)\b|yarn( install)?\b|pnpm install\b|pip3? install\b|apt-get install\b|apk add\b|go mod download\b|bundle install\b|composer install\b)/;

function commandBody(instruction: CfInstruction): string {
  const idx = instruction.raw.indexOf(instruction.rawKeyword);
  const after = idx >= 0 ? instruction.raw.slice(idx + instruction.rawKeyword.length) : instruction.args;
  return after
    .replace(/\\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstArgToken(instruction: CfInstruction): string {
  return instruction.args.split(/\s+/).filter(Boolean)[0] ?? "";
}

export function lint(ast: ContainerfileAst): LintFinding[] {
  const findings: LintFinding[] = [];
  const stageNames = new Set(ast.stages.map((stage) => stage.name).filter(Boolean) as string[]);

  // CF001: a Containerfile must declare at least one FROM.
  if (ast.stages.length === 0) {
    findings.push({
      ruleId: "CF001",
      severity: "error",
      message: "No FROM instruction — a Containerfile must start from a base image.",
      range: { start: 0, end: 0 },
    });
  }

  for (const stage of ast.stages) {
    const ref = stage.from;
    const untagged = ref.length > 0 && !ref.includes(":") && !ref.includes("@");
    const isLatest = /:latest$/.test(ref);
    if (ref && ref !== "scratch" && !stageNames.has(ref) && (isLatest || untagged)) {
      findings.push({
        ruleId: "CF002",
        severity: "warning",
        message: `Base image "${ref}" is ${isLatest ? "pinned to :latest" : "untagged"} — pin a specific tag or digest for reproducible builds.`,
        range: stage.instructions[0].range,
        fixHint: "Use an explicit version tag, e.g. node:20-alpine.",
      });
    }
  }

  for (const instruction of ast.instructions) {
    // CF005: unknown instruction keyword.
    if (!KNOWN_INSTRUCTIONS.has(instruction.instruction)) {
      findings.push({
        ruleId: "CF005",
        severity: "error",
        message: `Unknown instruction "${instruction.rawKeyword}".`,
        range: instruction.range,
      });
      continue;
    }

    if (instruction.instruction === "RUN") {
      const body = commandBody(instruction);
      // CF003: package install without cleanup in the same layer bloats the image.
      const installsApt = /\bapt(-get)?\s+install\b/.test(body);
      const cleansApt = /rm\s+-rf\s+\/var\/lib\/apt\/lists/.test(body);
      const installsApk = /\bapk\s+add\b/.test(body);
      const cleansApk = /--no-cache\b/.test(body) || /rm\s+-rf\s+\/var\/cache\/apk/.test(body);
      const installsYum = /\b(yum|dnf)\s+install\b/.test(body);
      const cleansYum = /\b(yum|dnf)\s+clean\s+all\b/.test(body);
      if ((installsApt && !cleansApt) || (installsApk && !cleansApk) || (installsYum && !cleansYum)) {
        findings.push({
          ruleId: "CF003",
          severity: "warning",
          message: "Package install without cleaning the package cache in the same RUN grows the layer.",
          range: instruction.range,
          fixHint: "Append the matching cleanup (e.g. rm -rf /var/lib/apt/lists/*) to this RUN.",
        });
      }
      // CF006: prefer WORKDIR over a bare `cd`.
      if (/^cd\s+\S/.test(body)) {
        findings.push({
          ruleId: "CF006",
          severity: "info",
          message: "Use WORKDIR instead of `RUN cd` — cd does not persist to later instructions.",
          range: instruction.range,
        });
      }
    }

    // CF004: ADD of a plain local path where COPY is clearer/safer.
    if (instruction.instruction === "ADD") {
      const src = firstArgToken(instruction);
      const isRemote = /^https?:\/\//.test(src);
      const isArchive = /\.(tar|tgz|tar\.gz|tar\.bz2|tar\.xz|zip)$/.test(src);
      if (src && !isRemote && !isArchive) {
        findings.push({
          ruleId: "CF004",
          severity: "info",
          message: "Prefer COPY over ADD for local files (ADD has surprising archive/URL semantics).",
          range: instruction.range,
        });
      }
    }

    // CF009: secret-looking value baked into the image.
    if (instruction.instruction === "ENV" || instruction.instruction === "ARG") {
      if (/\b(PASSWORD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY)\b/i.test(instruction.args) && /=\S/.test(instruction.args)) {
        findings.push({
          ruleId: "CF009",
          severity: "warning",
          message: "Secret-looking value in an ENV/ARG is baked into the image — use --secret mounts instead.",
          range: instruction.range,
        });
      }
    }
  }

  // CF007: copying the whole build context before a dependency install busts the cache on every source edit.
  for (const stage of ast.stages) {
    const wholeContextCopyIndex = stage.instructions.findIndex(
      (instruction) => instruction.instruction === "COPY" && firstArgToken(instruction) === ".",
    );
    if (wholeContextCopyIndex >= 0) {
      const installsAfter = stage.instructions
        .slice(wholeContextCopyIndex + 1)
        .some((instruction) => instruction.instruction === "RUN" && INSTALL_RE.test(commandBody(instruction)));
      if (installsAfter) {
        findings.push({
          ruleId: "CF007",
          severity: "warning",
          message: "COPY . . before installing dependencies busts the layer cache on every source change.",
          range: stage.instructions[wholeContextCopyIndex].range,
          fixHint: "Copy the manifest (package.json, requirements.txt…) and install first, then COPY the rest.",
        });
      }
    }
  }

  // CF008: the final stage runs as root when no USER is set.
  const lastStage = ast.stages[ast.stages.length - 1];
  if (lastStage && !lastStage.instructions.some((instruction) => instruction.instruction === "USER")) {
    findings.push({
      ruleId: "CF008",
      severity: "info",
      message: "No USER set — the image runs as root. Add a non-root USER for the runtime stage.",
      range: lastStage.instructions[0].range,
    });
  }

  // CF010: no HEALTHCHECK declared.
  if (!ast.instructions.some((instruction) => instruction.instruction === "HEALTHCHECK")) {
    findings.push({
      ruleId: "CF010",
      severity: "info",
      message: "No HEALTHCHECK — the runtime cannot tell whether the container is healthy.",
      range: { start: 0, end: 0 },
    });
  }

  return findings;
}
