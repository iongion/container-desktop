import { Button, InputGroup, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Notification } from "@/web-app/Notification";
import "./CopyToClipboardInput.css";

export interface CopyToClipboardInputProps {
  value: string;
  title?: string;
  className?: string;
}

// Minimal, readonly, monospace input with a copy-to-clipboard affordance.
export const CopyToClipboardInput: React.FC<CopyToClipboardInputProps> = ({ value, title, className }) => {
  const { t } = useTranslation();
  const onCopyToClipboardClick = useCallback(async () => {
    await navigator.clipboard.writeText(value);
    Notification.show({
      message: t("The value was copied to clipboard"),
      intent: Intent.SUCCESS,
    });
  }, [t, value]);
  return (
    <InputGroup
      className={`CopyToClipboardInput ${className || ""}`.trim()}
      title={title || value}
      value={value}
      size="small"
      readOnly
      fill
      leftElement={
        <Button
          size="small"
          variant="minimal"
          icon={IconNames.CLIPBOARD}
          title={t("Copy to clipboard")}
          onClick={onCopyToClipboardClick}
        />
      }
    />
  );
};
