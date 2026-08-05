// The "assistant is working" indicator — a Blueprint spinner beside a status word that cycles through a
// playful list. No external spinner library (Blueprint Spinner is already a core dep); shown above the
// composer input while the model is producing output. First pass for review before weighing react-spinners.
import { Spinner } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SessionRetry } from "@/web-app/stores/codingAgent";

import "./ThinkingStatus.css";

const THINKING_WORDS = [
  "Percolating",
  "Unraveling",
  "Crunching",
  "Distilling",
  "Hydrating context",
  "Negotiating with cgroups",
  "Inspecting namespaces",
  "Warming containers",
  "Poking the daemon",
  "Reading the tea logs",
  "Untangling volumes",
  "Consulting the socket",
  "Reticulating splines",
  "Summoning layers",
  "Rebuilding assumptions",
];

// `message` is a plugin's own working message (pi's `setWorkingMessage`), shown verbatim and without the ellipsis
// the cycling words carry — it is the plugin's sentence, not one of ours. Absent restores the cycle. `retry`
// outranks both: it is the session explaining its own silence, and a retry waits out the whole of an exponential
// backoff, so the wait is counted down rather than merely named — a still spinner beside a fixed sentence is what
// a hang looks like.
export const ThinkingStatus: React.FC<{ message?: string; retry?: SessionRetry }> = ({ message, retry }) => {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (message || retry) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % THINKING_WORDS.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [message, retry]);

  useEffect(() => {
    if (!retry) return;
    setSecondsLeft(Math.ceil(retry.delayMs / 1_000));
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [retry]);

  const retryText = retry
    ? secondsLeft > 0
      ? t("Retrying ({{attempt}}/{{maxAttempts}}) in {{seconds}}s…", {
          attempt: retry.attempt,
          maxAttempts: retry.maxAttempts,
          seconds: secondsLeft,
        })
      : t("Retrying ({{attempt}}/{{maxAttempts}})…", { attempt: retry.attempt, maxAttempts: retry.maxAttempts })
    : undefined;

  return (
    <div className="ThinkingStatus">
      <Spinner size={16} />
      <span className="ThinkingStatusText">{retryText ?? message ?? `${THINKING_WORDS[index]}…`}</span>
    </div>
  );
};
