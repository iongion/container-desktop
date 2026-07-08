import { AnchorButton, Button, Icon, type IconName } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type { ReachabilityDiagnosis } from "@/container-client/reachability/model";
import { CopyButton } from "@/web-app/components/CopyButton";

import { CodeText } from "./CodeText";
import "./Diagnosis.css";

// Diagnosis — the shared "what's broken + how to fix" stripe: colored left border by tone, icon chip, headline +
// explanation (with inline `code`), an optional copy-able fix command, action links and a "Why does this happen?"
// learn-more link. Data model is the node-free ReachabilityDiagnosis. Used by the reachability debugger and the
// Engine Health cockpit. Actions with an external URL run through onAction (window.open); when omitted they are
// in-app AnchorButtons (hash routes).
export function Diagnosis({
  diagnosis,
  onAction,
  learnHref = "#/screens/troubleshoot",
}: {
  diagnosis: ReachabilityDiagnosis;
  onAction?: (href?: string) => void;
  learnHref?: string;
}) {
  const { t } = useTranslation();
  const actions = diagnosis.actions.filter((action) => action.href);
  const hasRow = actions.length > 0 || (diagnosis.learnMore && !!learnHref);
  return (
    <div className={`Diagnosis ${diagnosis.tone}`}>
      <div className="dico">
        <Icon icon={diagnosis.icon as IconName} />
      </div>
      <div className="dbody">
        <h5>
          <CodeText text={diagnosis.headline} />
        </h5>
        <p>
          <CodeText text={diagnosis.explanation} />
        </p>
        {diagnosis.fixCommand ? (
          <div className="fixcmd">
            <span className="cmd">{diagnosis.fixCommand}</span>
            <CopyButton text={diagnosis.fixCommand} title={t("Copy fix command")} />
          </div>
        ) : null}
        {hasRow ? (
          <div className="fixrow">
            {actions.map((action) =>
              onAction ? (
                <Button
                  key={action.id}
                  size="small"
                  variant="minimal"
                  icon={action.icon as IconName}
                  text={action.text}
                  onClick={() => onAction(action.href)}
                />
              ) : (
                <AnchorButton
                  key={action.id}
                  size="small"
                  variant="minimal"
                  icon={action.icon as IconName}
                  text={action.text}
                  href={action.href}
                />
              ),
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
