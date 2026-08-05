// Generative-UI card for an edit. Two sources, one look: pi's `edit` returns a ready unified patch in
// `details.patch`, which is rendered with both line-number gutters; the app's own editFile returns before/after
// text, diffed here with jsdiff and folded so a small edit to a big file stays scannable.
import { IconNames } from "@blueprintjs/icons";
import { diffLines } from "diff";
import { useTranslation } from "react-i18next";

import { parseUnifiedPatch } from "@/ai-system/core/unifiedPatch";

import { AICardShell } from "./AICardShell";
import type { ToolCardProps } from "./types";

const CONTEXT = 3;

interface DiffRow {
  key: string;
  text: string;
  cls: string;
}

// Split a change into display lines, dropping the trailing empty split and folding long unchanged runs.
function partLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// A patch already says which side each line belongs to and what it is numbered, so it renders directly —
// reconstructing before/after just to re-diff it would throw the real line numbers away.
const PatchBody: React.FC<{ patch: string }> = ({ patch }) => {
  const { hunks } = parseUnifiedPatch(patch);
  return (
    <div className="AICardDiff">
      {hunks.map((hunk) => (
        <div key={hunk.header} className="AICardDiffHunk">
          <span className="AICardDiffLine AICardDiffLine--meta">{hunk.header}</span>
          {hunk.lines.map((line) => (
            // Within a hunk a line is identified by the side it is numbered on: added lines have distinct new
            // numbers, removed lines distinct old ones, context lines both.
            <span
              key={`${hunk.header}-${line.kind}-${line.oldLine ?? ""}-${line.newLine ?? ""}`}
              className={`AICardDiffLine ${
                line.kind === "added" ? "AICardDiffLine--add" : line.kind === "removed" ? "AICardDiffLine--del" : ""
              }`}
            >
              <span className="AICardDiffNum">{line.oldLine ?? ""}</span>
              <span className="AICardDiffNum">{line.newLine ?? ""}</span>
              {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "} {line.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};

export const DiffCard: React.FC<ToolCardProps> = ({ title, result }) => {
  const { t } = useTranslation();
  const data = (result ?? {}) as { path?: string; before?: string; after?: string; patch?: string };

  if (data.patch) {
    const { added, removed, path: patchPath } = parseUnifiedPatch(data.patch);
    const heading = title || data.path || patchPath || t("Edit");
    return (
      <AICardShell title={added || removed ? `${heading} · +${added}/−${removed}` : heading} icon={IconNames.EDIT}>
        <PatchBody patch={data.patch} />
      </AICardShell>
    );
  }
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;

  for (const [index, part] of diffLines(data.before ?? "", data.after ?? "").entries()) {
    const cls = part.added ? "AICardDiffLine--add" : part.removed ? "AICardDiffLine--del" : "";
    const prefix = part.added ? "+" : part.removed ? "-" : " ";
    const lines = partLines(part.value);
    if (part.added) added += lines.length;
    if (part.removed) removed += lines.length;
    const shown =
      cls || lines.length <= CONTEXT * 2 + 1
        ? lines
        : [...lines.slice(0, CONTEXT), `… ${lines.length - CONTEXT * 2} unchanged lines`, ...lines.slice(-CONTEXT)];
    for (const [line, text] of shown.entries()) {
      const meta = !cls && text.startsWith("… ");
      rows.push({
        key: `${index}-${line}`,
        text: meta ? text : `${prefix} ${text}`,
        cls: meta ? "AICardDiffLine--meta" : cls,
      });
    }
  }

  const path = title || (data.path ? String(data.path) : t("Edit"));
  const heading = added || removed ? `${path} · +${added}/−${removed}` : path;

  return (
    <AICardShell title={heading} icon={IconNames.EDIT}>
      <div className="AICardDiff">
        {rows.map((row) => (
          <span key={row.key} className={`AICardDiffLine ${row.cls}`}>
            {row.text}
          </span>
        ))}
      </div>
    </AICardShell>
  );
};
