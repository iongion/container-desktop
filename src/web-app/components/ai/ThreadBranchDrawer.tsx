import { Button, Callout, Classes, FormGroup, HTMLSelect, InputGroup, Intent, Spinner, Tag } from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/ai-system/core/errors";
import type { ThreadView } from "@/ai-system/core/threadEvents";
import type { ThreadBranchPreview, ThreadCheckpoint, ThreadSummary } from "@/ai-system/core/threads";
import { resolveThreadCheckpointReference } from "@/ai-system/ui/core/threadCheckpointReference";
import { createLogger } from "@/logger";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { useAIStore } from "@/web-app/stores/useAIStore";

import "./ThreadBranchDrawer.css";

const logger = createLogger("web.ai.thread-branch");

export interface ThreadBranchSource {
  thread: ThreadSummary;
  view: ThreadView;
  checkpointReference?: string;
}

interface ThreadBranchDrawerProps {
  source: ThreadBranchSource;
  onClose: () => void;
}

function checkpointText(checkpoint: ThreadCheckpoint, view: ThreadView): string {
  const message = view.timeline.find((item) => item.kind === "message" && item.id === checkpoint.messageId);
  if (message?.kind !== "message") return checkpoint.id.slice(0, 12);
  const normalized = message.content.replace(/\s+/gu, " ").trim();
  return normalized.length > 72 ? `${normalized.slice(0, 69)}…` : normalized;
}

export function ThreadBranchDrawer({ source, onClose }: ThreadBranchDrawerProps) {
  const { t } = useTranslation();
  const formId = useId();
  const previewThreadBranch = useAIStore((state) => state.previewThreadBranch);
  const branchThread = useAIStore((state) => state.branchThread);
  const [preview, setPreview] = useState<ThreadBranchPreview>();
  const [checkpointId, setCheckpointId] = useState("");
  const [title, setTitle] = useState(t("{{title}} branch", { title: source.thread.title }));
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(undefined);
    void previewThreadBranch(source.thread.id)
      .then((next) => {
        if (!current) return;
        setPreview(next);
        const checkpoint = resolveThreadCheckpointReference(next.checkpoints, source.checkpointReference ?? "");
        if (checkpoint) setCheckpointId(checkpoint.id);
        else if (source.checkpointReference) setError(t("Checkpoint not found or not unique"));
      })
      .catch((cause) => {
        const message = describeError(cause);
        logger.error("Thread branch preview failed", { threadId: source.thread.id, error: message });
        if (current) setError(message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [previewThreadBranch, source.checkpointReference, source.thread.id, t]);

  const checkpoints = useMemo(() => [...(preview?.checkpoints ?? [])].reverse(), [preview?.checkpoints]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!checkpointId || !title.trim()) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await branchThread(source.thread.id, checkpointId, title.trim());
      onClose();
    } catch (cause) {
      const message = describeError(cause);
      logger.error("Thread branch failed", { threadId: source.thread.id, checkpointId, error: message });
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppDrawer
      className="ThreadBranchDrawer"
      icon={IconNames.GIT_BRANCH}
      title={t("Branch Thread")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitting={submitting}
      submitDisabled={loading || !checkpointId || !title.trim()}
      submitIcon={IconNames.GIT_BRANCH}
      submitTitle={t("Create branch")}
    >
      <div className={Classes.DRAWER_BODY}>
        <form id={formId} className={Classes.DIALOG_BODY} onSubmit={(event) => void submit(event)}>
          {loading ? (
            <div className="ThreadBranchLoading">
              <Spinner size={24} />
              <span>{t("Loading checkpoints…")}</span>
            </div>
          ) : (
            <div className="AppDataForm ThreadBranchForm">
              <FormGroup label={t("Branch name")} labelFor="threadBranchTitle" labelInfo={t("(required)")}>
                <InputGroup
                  id="threadBranchTitle"
                  autoFocus
                  required
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                />
              </FormGroup>
              <FormGroup
                label={t("Checkpoint")}
                labelFor="threadBranchCheckpoint"
                helperText={t("Only completed conversation boundaries can be branched.")}
              >
                <HTMLSelect
                  id="threadBranchCheckpoint"
                  fill
                  value={checkpointId}
                  disabled={checkpoints.length === 0}
                  onChange={(event) => setCheckpointId(event.currentTarget.value)}
                >
                  {checkpoints.length === 0 ? <option value="">{t("No checkpoints available")}</option> : null}
                  {checkpoints.map((checkpoint) => (
                    <option key={checkpoint.id} value={checkpoint.id}>
                      {checkpointText(checkpoint, source.view)}
                    </option>
                  ))}
                </HTMLSelect>
              </FormGroup>
              {preview ? (
                <section className="ThreadBranchBindings" aria-label={t("Inherited bindings")}>
                  <div>
                    <span>{t("Model")}</span>
                    <strong>
                      {[preview.bindings.providerId, preview.bindings.model].filter(Boolean).join(" / ") ||
                        t("Default")}
                    </strong>
                  </div>
                  <div>
                    <span>{t("Workspace")}</span>
                    <strong>{preview.bindings.workspaceRoot ?? t("Not configured")}</strong>
                  </div>
                  <div>
                    <span>{t("Access")}</span>
                    <Tag minimal>{t(preview.bindings.permissionMode)}</Tag>
                  </div>
                  <div>
                    <span>{t("Context")}</span>
                    <Tag minimal>{t("Application")}</Tag>
                  </div>
                  <div>
                    <span>{t("Target")}</span>
                    <Tag minimal>{t("Host")}</Tag>
                  </div>
                </section>
              ) : null}
              <Callout icon={IconNames.INFO_SIGN}>
                {t(
                  "Conversation history is copied. Container, filesystem, remote, and external service state is not restored.",
                )}
              </Callout>
              {error ? <Callout intent={Intent.DANGER}>{error}</Callout> : null}
              <Button
                type="submit"
                intent={Intent.SUCCESS}
                icon={IconNames.GIT_BRANCH}
                text={t("Create branch")}
                loading={submitting}
                disabled={!checkpointId || !title.trim()}
              />
            </div>
          )}
        </form>
      </div>
    </AppDrawer>
  );
}
