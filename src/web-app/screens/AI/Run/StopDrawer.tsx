import { Button, ButtonGroup, Callout, Classes, Intent } from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RunView } from "@/ai-system/core/runEvents";
import { AppDrawer } from "@/web-app/components/AppDrawer";

export interface StopDrawerProps {
  run: RunView;
  onClose: () => void;
  onStop: (runId: string) => void | Promise<void>;
}

export function StopDrawer({ run, onClose, onStop }: StopDrawerProps) {
  const { t } = useTranslation();
  const formId = useId();
  const [stopping, setStopping] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStopping(true);
    try {
      await onStop(run.runId);
      onClose();
    } finally {
      setStopping(false);
    }
  };

  return (
    <AppDrawer
      icon={IconNames.STOP}
      title={t("Stop Run")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitting={stopping}
      submitIcon={IconNames.STOP}
      submitTitle={t("Stop Run")}
      submitIntent="danger"
    >
      <div className={Classes.DRAWER_BODY}>
        <form id={formId} className={Classes.DIALOG_BODY} onSubmit={(event) => void submit(event)}>
          <div className="AppDataForm">
            <Callout intent={Intent.WARNING} icon={IconNames.WARNING_SIGN}>
              {t("Active tasks will stop after their current operation finishes.")}
            </Callout>
            <strong>{run.goal}</strong>
          </div>
          <ButtonGroup fill>
            <Button type="button" text={t("Cancel")} onClick={onClose} disabled={stopping} />
            <Button
              type="submit"
              intent={Intent.DANGER}
              icon={IconNames.STOP}
              text={t("Stop Run")}
              loading={stopping}
            />
          </ButtonGroup>
        </form>
      </div>
    </AppDrawer>
  );
}
