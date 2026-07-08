import { Button, ButtonGroup, Callout, H5 } from "@blueprintjs/core";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";

import { t } from "@/i18n";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { JsonTreeView, type JsonTreeViewHandle } from "@/web-app/components/JsonTreeView";
import { safeParseJson } from "@/web-app/components/jsonTree";

import "./JsonView.css";

export type JsonViewMode = "tree" | "json";

export interface JsonViewProps {
  // Raw JSON text. Shown verbatim in the JSON view (byte-identical to the previous CodeEditor behavior);
  // parsed for the Tree view. Never throws on malformed/incomplete JSON — it falls back to raw text.
  value: string;
  // Section header; when omitted defaults to the active view ("Tree view" / "Raw configuration").
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
  const showTree = effectiveView === "tree" && parsed.ok;
  const defaultTitle = showTree ? t("Tree view") : t("Raw configuration");

  const treeRef = useRef<JsonTreeViewHandle>(null);
  // Tracks the last bulk action so the toggle shows the right icon. Switching to JSON resets it; the tree
  // itself always mounts collapsed, so entering the tree view starts from the collapsed (expand-all) icon.
  const [allExpanded, setAllExpanded] = useState(false);

  const toggleExpandAll = () => {
    if (allExpanded) {
      treeRef.current?.collapseAll();
      setAllExpanded(false);
    } else {
      treeRef.current?.expandAll();
      setAllExpanded(true);
    }
  };
  const showJson = () => {
    setView("json");
    setAllExpanded(false);
  };

  return (
    <>
      <H5 className={`JsonViewHeader ${headerClassName ?? ""}`.trim()}>
        {showTree ? (
          <Button
            className="JsonViewExpandToggle"
            variant="minimal"
            size="small"
            icon={allExpanded ? "collapse-all" : "expand-all"}
            title={allExpanded ? t("Collapse all") : t("Expand all")}
            aria-label={allExpanded ? t("Collapse all") : t("Expand all")}
            onClick={toggleExpandAll}
          />
        ) : null}
        <span className="JsonViewTitle">{title ?? defaultTitle}</span>
        <span className="JsonViewHeaderFill" />
        <ButtonGroup className="JsonViewSwitch">
          <Button
            size="small"
            text={t("Tree")}
            active={effectiveView === "tree"}
            disabled={!parsed.ok}
            onClick={() => setView("tree")}
          />
          <Button size="small" text={t("JSON")} active={effectiveView === "json"} onClick={showJson} />
        </ButtonGroup>
      </H5>
      <div className={`JsonViewFrame ${frameClassName ?? ""}`.trim()}>
        {showTree ? (
          <JsonTreeView ref={treeRef} data={parsed.data} />
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
