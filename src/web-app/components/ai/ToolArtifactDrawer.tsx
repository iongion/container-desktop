import { Callout, Classes, Intent, Spinner } from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { describeError } from "@/ai-system/core/errors";
import type { ToolArtifactRecord, ToolArtifactReference } from "@/ai-system/core/toolArtifacts";
import { createLogger } from "@/logger";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { CopyButton } from "@/web-app/components/CopyButton";

const logger = createLogger("web.ai.tool-artifact");

interface ToolArtifactDrawerProps {
  threadId: string;
  artifact: ToolArtifactReference;
  title: string;
  onClose: () => void;
}

function formattedContent(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

export function ToolArtifactDrawer({ threadId, artifact, title, onClose }: ToolArtifactDrawerProps) {
  const { t } = useTranslation();
  const [record, setRecord] = useState<ToolArtifactRecord>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void window.AI.getToolArtifact(threadId, artifact.id)
      .then((next) => {
        if (active) setRecord(next);
      })
      .catch((cause) => {
        const message = describeError(cause);
        logger.error("Tool artifact load failed", { threadId, artifactId: artifact.id, error: message });
        if (active) setError(message);
      });
    return () => {
      active = false;
    };
  }, [artifact.id, threadId]);

  const content = useMemo(() => (record ? formattedContent(record.content) : ""), [record]);
  return (
    <AppDrawer title={t("Full tool result")} icon={IconNames.DOCUMENT_OPEN} size={DrawerSize.SMALL} onClose={onClose}>
      <div className={Classes.DRAWER_BODY}>
        <div className={Classes.DIALOG_BODY}>
          <div className="ToolArtifactHeading">
            <strong>{title}</strong>
            <span>{t("{{size}} bytes", { size: artifact.byteLength.toLocaleString() })}</span>
          </div>
          {error ? <Callout intent={Intent.DANGER}>{error}</Callout> : null}
          {!record && !error ? <Spinner size={24} /> : null}
          {record ? (
            <>
              <pre className="ToolArtifactContent">{content}</pre>
              <CopyButton text={content} title={t("Copy full result")} variant="outlined" />
            </>
          ) : null}
        </div>
      </div>
    </AppDrawer>
  );
}
