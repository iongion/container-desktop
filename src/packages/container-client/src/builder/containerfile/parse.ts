// Lossless Containerfile parser. The whole source is tiled, line by line, into instruction nodes so that
// concatenating each node's exact `raw` slice reproduces the input byte-for-byte (see serialize.ts). Leading
// blank/comment lines attach to the following instruction; trailing trivia attaches to the last one. Line
// continuations (`\`) and here-docs (`<<EOF … EOF`) are folded into a single instruction. Stages start on
// FROM. The goal is faithful projection of the Containerfile, not a semantic model.

import type { CfInstruction, CfStage, ContainerfileAst } from "../types";

const KEYWORD_RE = /^\s*([A-Za-z][A-Za-z0-9_]*)(?:\s+([\s\S]*))?$/;
const HEREDOC_RE = /<<-?\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?/g;

function isTrivia(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

function endsWithContinuation(line: string): boolean {
  return /\\\s*$/.test(line) && !/^\s*#/.test(line);
}

function collectHeredocTerminators(line: string): string[] {
  const terminators: string[] = [];
  for (const match of line.matchAll(HEREDOC_RE)) {
    terminators.push(match[1]);
  }
  return terminators;
}

// Given the keyword line at `start`, return the index of the instruction's LAST line (folding
// continuations and here-doc bodies).
function instructionEndLine(lines: string[], start: number): number {
  let index = start;
  let heredocs = collectHeredocTerminators(lines[start]);
  let continues = heredocs.length === 0 && endsWithContinuation(lines[start]);
  while ((heredocs.length > 0 || continues) && index + 1 < lines.length) {
    index += 1;
    if (heredocs.length > 0) {
      if (lines[index].trim() === heredocs[0]) {
        heredocs.shift();
      }
      if (heredocs.length === 0) {
        continues = endsWithContinuation(lines[index]);
      }
    } else {
      heredocs = collectHeredocTerminators(lines[index]);
      continues = heredocs.length === 0 && endsWithContinuation(lines[index]);
    }
  }
  return index;
}

function parseFlagsAndArgs(argText: string): { flags: Record<string, string | boolean>; args: string } {
  const flags: Record<string, string | boolean> = {};
  const tokens = argText.split(/\s+/).filter(Boolean);
  const rest: string[] = [];
  for (const token of tokens) {
    const flagMatch = token.match(/^--([A-Za-z0-9-]+)(?:=(.*))?$/);
    if (flagMatch) {
      flags[flagMatch[1]] = flagMatch[2] ?? true;
    } else {
      rest.push(token);
    }
  }
  return { flags, args: rest.join(" ") };
}

function stageName(argText: string): string | undefined {
  const match = argText.match(/\bAS\s+([A-Za-z0-9_][A-Za-z0-9_.-]*)/i);
  return match ? match[1] : undefined;
}

export function parse(source: string): ContainerfileAst {
  const lines = source.split("\n");
  const instructions: CfInstruction[] = [];
  const stages: CfStage[] = [];
  let stageIndex = -1;
  let cursor = 0;

  while (cursor < lines.length) {
    const nodeStart = cursor;
    const comments: string[] = [];
    while (cursor < lines.length && isTrivia(lines[cursor])) {
      if (lines[cursor].trim().startsWith("#")) {
        comments.push(lines[cursor]);
      }
      cursor += 1;
    }
    if (cursor >= lines.length) {
      // Trailing trivia: fold it into the previous instruction so every line is owned by exactly one node.
      if (instructions.length > 0) {
        const last = instructions[instructions.length - 1];
        last.raw = lines.slice(last.range.start, lines.length).join("\n");
        last.range = { start: last.range.start, end: lines.length - 1 };
      }
      break;
    }
    const keywordLineIndex = cursor;
    const endLine = instructionEndLine(lines, keywordLineIndex);
    const keywordLine = lines[keywordLineIndex];
    const keywordMatch = keywordLine.match(KEYWORD_RE);
    const rawKeyword = keywordMatch?.[1] ?? keywordLine.trim();
    const instruction = rawKeyword.toUpperCase();
    const argText = (keywordMatch?.[2] ?? "").replace(/\\\s*$/, "").trim();
    const { flags, args } = parseFlagsAndArgs(argText);

    if (instruction === "FROM") {
      stageIndex += 1;
    }

    const node: CfInstruction = {
      id: `${stageIndex}:${instructions.length}`,
      instruction,
      rawKeyword,
      args,
      flags,
      range: { start: nodeStart, end: endLine },
      comments,
      raw: lines.slice(nodeStart, endLine + 1).join("\n"),
      stageIndex,
    };
    instructions.push(node);

    if (instruction === "FROM") {
      stages.push({
        index: stageIndex,
        name: stageName(argText),
        from: args.split(/\s+/)[0] ?? "",
        instructions: [node],
        range: { start: nodeStart, end: endLine },
      });
    } else if (stages.length > 0 && stageIndex >= 0) {
      stages[stages.length - 1].instructions.push(node);
      stages[stages.length - 1].range = { start: stages[stages.length - 1].range.start, end: endLine };
    }

    cursor = endLine + 1;
  }

  return { source, stages, instructions };
}
