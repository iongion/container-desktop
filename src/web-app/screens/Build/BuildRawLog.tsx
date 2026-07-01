import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { BuildRun } from "@/container-client/build/types";
import { Terminal } from "@/web-app/components/Terminal";

export interface BuildRawLogProps {
  run?: BuildRun;
}

export const BuildRawLog: React.FC<BuildRawLogProps> = ({ run }) => {
  const { t } = useTranslation();
  // The combined engine output, rendered through xterm so ANSI colours (npm, buildx, apt…) show as the engine
  // emitted them. xterm needs CR+LF, so lone "\n" are normalised to "\r\n" to avoid a staircased log.
  const text = useMemo(() => {
    if (!run) {
      return "";
    }
    const raw = run.rawLogTail ?? run.steps.flatMap((step) => step.logs.map((line) => line.text)).join("\n");
    return raw.replace(/\r?\n/g, "\r\n");
  }, [run]);

  return (
    <>
      <div className="run-terminal">
        <Terminal value={text} writeMode="replace" />
      </div>
      <div className="panel-footer">{t("Raw engine output (combined stdout/stderr, capped).")}</div>
    </>
  );
};
