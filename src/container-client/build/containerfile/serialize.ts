// Inverse of parse(): concatenate each instruction's exact `raw` slice. Because the parser tiles every
// source line into exactly one node (leading/trailing trivia included), joining the raws with a newline
// reproduces the original source byte-for-byte. Falls back to the stored source when there are no
// instructions (a comment-only file).

import type { ContainerfileAst } from "../types";

export function serialize(ast: ContainerfileAst): string {
  if (ast.instructions.length === 0) {
    return ast.source;
  }
  return ast.instructions.map((instruction) => instruction.raw).join("\n");
}
