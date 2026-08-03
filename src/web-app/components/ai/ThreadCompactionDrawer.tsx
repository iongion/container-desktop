import { Button, Callout, Classes, FormGroup, Intent, Spinner, Tag, TextArea } from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/ai-system/core/errors";
import type { ThreadCompactionExecutionResult, ThreadCompactionPreview } from "@/ai-system/core/threadCompaction";
import type { ThreadSummary } from "@/ai-system/core/threads";
import { createLogger } from "@/logger";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { useAIStore } from "@/web-app/stores/useAIStore";

import "./ThreadCompactionDrawer.css";

const logger = createLogger("web.ai.thread-compaction");

interface ThreadCompactionDrawerProps {
  thread: ThreadSummary;
  initialInstructions?: string;
  onClose: () => void;
}

export function ThreadCompactionDrawer({ thread, initialInstructions = "", onClose }: ThreadCompactionDrawerProps) {
  const { t } = useTranslation();
  const formId = useId();
  const previewThreadCompaction = useAIStore((state) => state.previewThreadCompaction);
  const compactThread = useAIStore((state) => state.compactThread);
  const [preview, setPreview] = useState<ThreadCompactionPreview>();
  const [result, setResult] = useState<ThreadCompactionExecutionResult>();
  const [instructions, setInstructions] = useState(initialInstructions);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(undefined);
    void previewThreadCompaction(thread.id)
      .then((next) => {
        if (current) setPreview(next);
      })
      .catch((cause) => {
        const message = describeError(cause);
        logger.error("Thread compaction preview failed", { threadId: thread.id, error: message });
        if (current) setError(message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [previewThreadCompaction, thread.id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!preview) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const compacted = await compactThread(thread.id, preview.plan.revision, instructions.trim() || undefined);
      setResult(compacted);
    } catch (cause) {
      const message = describeError(cause);
      logger.error("Thread compaction failed", { threadId: thread.id, error: message });
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const compaction = result?.compaction;

  return (
    <AppDrawer
      className="ThreadCompactionDrawer"
      icon={IconNames.COMPRESSED}
      title={t("Compact Thread")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={result ? undefined : formId}
      submitting={submitting}
      submitDisabled={loading || !preview}
      submitIcon={IconNames.COMPRESSED}
      submitTitle={t("Compact Thread")}
    >
      <div className={Classes.DRAWER_BODY}>
        <form id={formId} className={Classes.DIALOG_BODY} onSubmit={(event) => void submit(event)}>
          {loading ? (
            <div className="ThreadCompactionLoading">
              <Spinner size={24} />
              <span>{t("Preparing compaction preview…")}</span>
            </div>
          ) : compaction ? (
            <div className="AppDataForm ThreadCompactionForm">
              <Callout intent={Intent.SUCCESS} icon={IconNames.TICK}>
                {t("Earlier context was compacted. The complete Thread timeline remains available.")}
              </Callout>
              <section className="ThreadCompactionFacts" aria-label={t("Compaction result")}>
                <div>
                  <span>{t("Source")}</span>
                  <strong>
                    {t("{{start}}–{{end}} of {{total}} messages", {
                      start: compaction.source.historyStart + 1,
                      end: compaction.source.historyEnd,
                      total: preview
                        ? preview.plan.sourceHistoryMessages + preview.plan.retainedHistoryMessages
                        : compaction.source.historyEnd,
                    })}
                  </strong>
                </div>
                <div>
                  <span>{t("Model")}</span>
                  <strong>
                    {[compaction.providerId, compaction.model].filter(Boolean).join(" / ") || t("Default")}
                  </strong>
                </div>
                <div>
                  <span>{t("Tokens")}</span>
                  <strong>
                    {t("{{input}} in / {{output}} out", {
                      input: compaction.inputTokens,
                      output: compaction.outputTokens,
                    })}
                  </strong>
                </div>
                <div>
                  <span>{t("Trust")}</span>
                  <Tag minimal intent={compaction.tainted ? Intent.WARNING : Intent.NONE}>
                    {t(compaction.contentTrust)}
                  </Tag>
                </div>
                <div className="ThreadCompactionFingerprint">
                  <span>{t("Fingerprint")}</span>
                  <code>{compaction.fingerprint}</code>
                </div>
              </section>
              <FormGroup label={t("Active summary")}>
                <pre className="ThreadCompactionSummary">{compaction.summary}</pre>
              </FormGroup>
              {compaction.instructions ? (
                <FormGroup label={t("Instructions")}>
                  <p className="ThreadCompactionInstructions">{compaction.instructions}</p>
                </FormGroup>
              ) : null}
              {error ? <Callout intent={Intent.DANGER}>{error}</Callout> : null}
              <Button icon={IconNames.TICK} intent={Intent.SUCCESS} text={t("Done")} onClick={onClose} />
            </div>
          ) : (
            <div className="AppDataForm ThreadCompactionForm">
              {preview ? (
                <section className="ThreadCompactionFacts" aria-label={t("Compaction preview")}>
                  <div>
                    <span>{t("Earlier context")}</span>
                    <strong>{t("{{count}} messages", { count: preview.plan.sourceHistoryMessages })}</strong>
                  </div>
                  <div>
                    <span>{t("Recent context retained")}</span>
                    <strong>{t("{{count}} messages", { count: preview.plan.retainedHistoryMessages })}</strong>
                  </div>
                  <div>
                    <span>{t("Model")}</span>
                    <strong>{[preview.providerId, preview.model].filter(Boolean).join(" / ") || t("Default")}</strong>
                  </div>
                  <div>
                    <span>{t("Timeline")}</span>
                    <Tag minimal intent={Intent.SUCCESS}>
                      {t("Preserved")}
                    </Tag>
                  </div>
                </section>
              ) : null}
              <FormGroup
                label={t("Summary instructions")}
                labelFor="threadCompactionInstructions"
                labelInfo={t("(optional)")}
                helperText={t("Describe decisions, constraints, or failed attempts that the summary must preserve.")}
              >
                <TextArea
                  id="threadCompactionInstructions"
                  autoFocus
                  fill
                  rows={4}
                  value={instructions}
                  onChange={(event) => setInstructions(event.currentTarget.value)}
                />
              </FormGroup>
              <Callout icon={IconNames.INFO_SIGN}>
                {t(
                  "Compaction changes only the active model context. It does not delete messages, tool results, or audit history.",
                )}
              </Callout>
              {preview?.active ? (
                <Callout intent={Intent.WARNING} icon={IconNames.HISTORY}>
                  {t("This replaces the current active summary with a newer checkpoint-aligned summary.")}
                </Callout>
              ) : null}
              {error ? <Callout intent={Intent.DANGER}>{error}</Callout> : null}
              <Button
                type="submit"
                intent={Intent.SUCCESS}
                icon={IconNames.COMPRESSED}
                text={t("Compact Thread")}
                loading={submitting}
                disabled={!preview}
              />
            </div>
          )}
        </form>
      </div>
    </AppDrawer>
  );
}
