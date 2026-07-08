import { Button, ButtonGroup, Callout, H5 } from "@blueprintjs/core";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { t } from "@/i18n";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { JsonTreeView } from "@/web-app/components/JsonTreeView";
import { safeParseJson } from "@/web-app/components/jsonTree";

import "./JsonView.css";

export type JsonViewMode = "tree" | "json";

export interface JsonViewProps {
  // Raw JSON text. Shown verbatim in the JSON view (byte-identical to the previous CodeEditor behavior);
  // parsed for the Tree view. Never throws on malformed/incomplete JSON — it falls back to raw text.
  value: string;
  // Section header; when omitted defaults to "Raw configuration".
  title?: ReactNode;
  // Which view to open on. Defaults to the tree drill-down.
  defaultView?: JsonViewMode;
  // Optional classes so a host (e.g. the Inspect screens) can reuse its existing header/frame styling.
  headerClassName?: string;
  frameClassName?: string;
}

// Reusable, schema-free two-view JSON viewer: Tree (native Blueprint <Tree>, collapsed drill-down) and
// JSON (the read-only Monaco editor, exactly as before). The single seam every raw-JSON screen uses.
export function JsonView({ value, title, defaultView = "tree", headerClassName, frameClassName }: JsonViewProps) {
  const parsed = useMemo(() => safeParseJson(value), [value]);
  const [view, setView] = useState<JsonViewMode>(defaultView);
  // If the payload can't be parsed, the tree is impossible — force (and pin) the JSON view.
  const effectiveView: JsonViewMode = parsed.ok ? view : "json";

  return (
    <>
      <H5 className={`JsonViewHeader ${headerClassName ?? ""}`.trim()}>
        <span className="JsonViewTitle">{title ?? t("Raw configuration")}</span>
        <span className="JsonViewHeaderFill" />
        <ButtonGroup className="JsonViewSwitch">
          <Button
            size="small"
            text={t("Tree")}
            active={effectiveView === "tree"}
            disabled={!parsed.ok}
            onClick={() => setView("tree")}
          />
          <Button size="small" text={t("JSON")} active={effectiveView === "json"} onClick={() => setView("json")} />
        </ButtonGroup>
      </H5>
      <div className={`JsonViewFrame ${frameClassName ?? ""}`.trim()}>
        {effectiveView === "tree" && parsed.ok ? (
          <JsonTreeView data={parsed.data} />
        ) : (
          <div className="CodeEditor JsonViewCode">
            {parsed.ok ? null : (
              <Callout intent="warning" icon="warning-sign" className="JsonViewParseWarning">
                {t("This data isn’t valid JSON, so the tree view is unavailable — showing the raw text as received.")}
              </Callout>
            )}
            <CodeEditor value={value} />
          </div>
        )}
      </div>
    </>
  );
}
