import { InputGroup } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { CopyButton } from "./CopyButton";
import "./CopyToClipboardInput.css";

export interface CopyToClipboardInputProps {
  value: string;
  title?: string;
  className?: string;
}

// Minimal, readonly, monospace input with a copy-to-clipboard affordance.
export const CopyToClipboardInput: React.FC<CopyToClipboardInputProps> = ({ value, title, className }) => {
  const { t } = useTranslation();
  return (
    <InputGroup
      className={`CopyToClipboardInput ${className || ""}`.trim()}
      title={title || value}
      value={value}
      size="small"
      readOnly
      fill
      leftElement={<CopyButton text={value} title={t("Copy to clipboard")} />}
    />
  );
};
