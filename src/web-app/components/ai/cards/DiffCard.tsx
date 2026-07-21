// Generative-UI card for editFile — a unified diff of the edit's before/after, computed in the renderer with
// jsdiff. Long unchanged runs are folded to a few lines of context so a small edit to a big file stays scannable.
import { IconNames } from "@blueprintjs/icons";
import { diffLines } from "diff";
import { useTranslation } from "react-i18next";

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

export const DiffCard: React.FC<ToolCardProps> = ({ result }) => {
  const { t } = useTranslation();
  const data = (result ?? {}) as { path?: string; before?: string; after?: string };
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

  const path = data.path ? String(data.path) : t("Edit");
  const title = added || removed ? `${path} · +${added}/−${removed}` : path;

  return (
    <AICardShell title={title} icon={IconNames.EDIT}>
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
