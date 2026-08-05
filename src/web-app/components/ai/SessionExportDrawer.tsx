import { Button, ButtonGroup, Callout, Classes, Intent } from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/ai-system/core/errors";
import type { SessionView } from "@/ai-system/core/sessionEvents";
import { createSanitizedSessionExport, sessionExportFilename } from "@/ai-system/core/sessionExport";
import type { SessionSummary } from "@/ai-system/core/sessions";
import { createLogger } from "@/logger";
import { getHostRuntime } from "@/platform/provider";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { CopyButton } from "@/web-app/components/CopyButton";
import "./SessionExportDrawer.css";

const logger = createLogger("web.ai.session-export");

export interface SessionExportDrawerProps {
  session: SessionSummary;
  view: SessionView;
  onClose: () => void;
}

export function SessionExportDrawer({ session, view, onClose }: SessionExportDrawerProps) {
  const { t } = useTranslation();
  const formId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const content = useMemo(() => JSON.stringify(createSanitizedSessionExport(session, view), null, 2), [session, view]);
  const messageCount = view.timeline.filter((item) => item.kind === "message").length;
  const operationCount = view.timeline.length - messageCount;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const runtime = getHostRuntime();
      const selection = await runtime.dialogs.saveFileSelector({
        defaultPath: sessionExportFilename(session.title),
        filters: [{ name: t("JSON files"), extensions: ["json"] }],
      });
      if (selection?.canceled || !selection?.filePath) return;
      await runtime.fs.writeTextFile(selection.filePath, `${content}\n`);
      onClose();
    } catch (cause) {
      const message = describeError(cause);
      logger.error("Session export failed", { sessionId: session.id, error: message });
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppDrawer
      className="SessionExportDrawer"
      icon={IconNames.EXPORT}
      title={t("Export Session")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitting={saving}
      submitIcon={IconNames.FLOPPY_DISK}
      submitTitle={t("Save export")}
    >
      <div className={Classes.DRAWER_BODY}>
        <form id={formId} className={Classes.DIALOG_BODY} onSubmit={(event) => void save(event)}>
          <div className="AppDataForm SessionExportSummary">
            <div>
              <span>{t("Session")}</span>
              <strong>{session.title}</strong>
            </div>
            <div>
              <span>{t("Messages")}</span>
              <strong>{messageCount}</strong>
            </div>
            <div>
              <span>{t("Operations")}</span>
              <strong>{operationCount}</strong>
            </div>
          </div>
          <Callout icon={IconNames.SHIELD}>
            {t("Secrets are redacted and internal runtime identifiers are excluded from this JSON export.")}
          </Callout>
          {error ? <Callout intent={Intent.DANGER}>{error}</Callout> : null}
          <ButtonGroup fill>
            <CopyButton text={content} title={t("Copy export to clipboard")} variant="outlined" size="medium" />
            <Button
              type="submit"
              intent={Intent.SUCCESS}
              icon={IconNames.FLOPPY_DISK}
              text={t("Save export")}
              loading={saving}
            />
          </ButtonGroup>
        </form>
      </div>
    </AppDrawer>
  );
}
