import { Button } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./CopyButton.css";

export interface CopyButtonProps {
  // The text placed on the clipboard when pressed.
  text: string;
  // Resting tooltip (defaults to "Copy"); swaps to "Copied" during the confirmation window.
  title?: string;
  // Resting icon (defaults to the clipboard glyph); swaps to a tick while copied.
  icon?: IconName;
  size?: "small" | "medium" | "large";
  variant?: "minimal" | "outlined" | "solid";
  className?: string;
  disabled?: boolean;
}

// How long the confirmation tick stays up after a successful copy.
const COPIED_RESET_MS = 1500;

// The single copy-to-clipboard affordance for the whole app. Every copy button funnels through this so they
// all confirm the same way — a brief in-button tick that replaces the icon — never a toast/notification.
export const CopyButton: React.FC<CopyButtonProps> = ({
  text,
  title,
  icon = IconNames.CLIPBOARD,
  size = "small",
  variant = "minimal",
  className,
  disabled,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  // Clear a pending reset if the button unmounts mid-confirmation.
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.clearTimeout(resetTimer.current);
        resetTimer.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
      },
      () => undefined,
    );
  }, [text]);

  const label = title ?? t("Copy");
  return (
    <Button
      className={`CopyButton${copied ? " CopyButton--copied" : ""}${className ? ` ${className}` : ""}`}
      size={size}
      variant={variant}
      icon={copied ? IconNames.TICK : icon}
      title={copied ? t("Copied") : label}
      aria-label={label}
      disabled={disabled}
      onClick={onCopy}
    />
  );
};
