import { Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { LintFinding } from "@/container-client/builder/types";
import { CodeEditor } from "@/web-app/components/CodeEditor";

import { lintFindingsToMarkers } from "./lintMarkers";

export interface ContainerfileEditorPaneProps {
  engine: string;
  value: string;
  onChange: (value: string) => void;
  findings: LintFinding[];
}

export const ContainerfileEditorPane: React.FC<ContainerfileEditorPaneProps> = ({
  engine,
  value,
  onChange,
  findings,
}) => {
  const { t } = useTranslation();
  const markers = useMemo(() => lintFindingsToMarkers(findings), [findings]);

  return (
    <section className="panel editor-panel" data-region="editor">
      <header>
        <Icon icon={IconNames.DOCUMENT} />
        {t("Containerfile")}
        <span className="sub">— {engine}</span>
      </header>
      <div className="body">
        <div className="editor-host">
          <CodeEditor
            mode="dockerfile"
            value={value}
            readOnly={false}
            onChange={onChange}
            markers={markers}
            overflowWidgetsFixed
          />
        </div>
        <div className="lint">
          {findings.length === 0 ? (
            <div className="lint-row">
              <span className="muted">{t("No lint findings — looks good.")}</span>
            </div>
          ) : (
            findings.map((finding) => (
              <div className="lint-row" key={`${finding.ruleId}:${finding.range.start}`}>
                <span className={`badge ${finding.severity}`}>{finding.ruleId}</span>
                <span className="msg">{finding.message}</span>
                <span className="where">L{finding.range.start + 1}</span>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="panel-footer">{t("{{count}} lint findings", { count: findings.length })} · CF001–CF010</div>
    </section>
  );
};
