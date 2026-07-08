import { Button, InputGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import type React from "react";
import { useTranslation } from "react-i18next";

export interface FindWidgetProps {
  query: string;
  onQueryChange: (value: string) => void;
  caseSensitive: boolean;
  onToggleCase: () => void;
  index: number;
  count: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  onKeyDown: React.KeyboardEventHandler<HTMLElement>;
  onKeyUp: React.KeyboardEventHandler<HTMLElement>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  style?: React.CSSProperties;
}

export const FindWidget: React.FC<FindWidgetProps> = ({
  query,
  onQueryChange,
  caseSensitive,
  onToggleCase,
  index,
  count,
  onNext,
  onPrevious,
  onClose,
  onKeyDown,
  onKeyUp,
  inputRef,
  style,
}: FindWidgetProps) => {
  const { t } = useTranslation();
  const hasQuery = query.length > 0;
  const noMatches = hasQuery && count === 0;
  return (
    <search
      className="ContainerFindWidget"
      data-no-matches={noMatches ? "yes" : "no"}
      style={style}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      <InputGroup
        className="ContainerFindWidgetInput"
        inputRef={inputRef}
        value={query}
        leftIcon={IconNames.SEARCH}
        placeholder={t("Find")}
        aria-label={t("Find in view")}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      <span className="ContainerFindWidgetCount" aria-live="polite">
        {hasQuery ? (count ? `${index}/${count}` : t("No results")) : ""}
      </span>
      <Button
        className="ContainerFindWidgetCase"
        size="small"
        variant="minimal"
        active={caseSensitive}
        title={t("Match case")}
        aria-label={t("Match case")}
        text="Aa"
        onClick={onToggleCase}
      />
      <Button
        size="small"
        variant="minimal"
        icon={IconNames.CHEVRON_UP}
        title={t("Previous match (Shift+Enter)")}
        aria-label={t("Previous match")}
        disabled={!count}
        onClick={onPrevious}
      />
      <Button
        size="small"
        variant="minimal"
        icon={IconNames.CHEVRON_DOWN}
        title={t("Next match (Enter)")}
        aria-label={t("Next match")}
        disabled={!count}
        onClick={onNext}
      />
      <Button
        size="small"
        variant="minimal"
        icon={IconNames.CROSS}
        title={t("Close (Esc)")}
        aria-label={t("Close find")}
        onClick={onClose}
      />
    </search>
  );
};
