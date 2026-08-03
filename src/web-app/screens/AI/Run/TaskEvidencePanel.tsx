import { NonIdealState, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { RunSpanView, RunTaskView } from "@/ai-system/core/runEvents";
import { toolTitle } from "@/ai-system/ui/core/toolTitle";
import { AssistantMarkdown } from "@/web-app/components/ai/AssistantMarkdown";
import { ToolCard } from "@/web-app/components/ai/cards/registry";
import { InspectTabs } from "@/web-app/components/InspectTabs";
import { JsonTreeView } from "@/web-app/components/JsonTreeView";
import { PropertyValueTable, type PropertyValueTableRow } from "@/web-app/components/PropertyValueTable";
import { compactTokens, formatCost, formatDurationMs } from "@/web-app/utils/format";

interface TaskEvidencePanelProps {
  task: RunTaskView | undefined;
  tasks: RunTaskView[];
  spans: RunSpanView[];
}

const show = (value: string | number | undefined): string =>
  value === undefined || value === "" ? "—" : String(value);

function evidenceRows(
  task: RunTaskView,
  spans: RunSpanView[],
  t: ReturnType<typeof useTranslation>["t"],
): PropertyValueTableRow[] {
  const taskSpan = spans.find((span) => span.kind === "task");
  return [
    { key: "kind", label: t("Kind"), value: t(taskSpan?.kind ?? "task") },
    { key: "duration", label: t("Duration"), value: formatDurationMs(task.durationMs ?? taskSpan?.durationMs) },
    { key: "agent", label: t("Agent"), value: task.agent },
    { key: "model", label: t("Model"), value: show(task.model), mono: true },
    { key: "provider", label: t("Provider"), value: show(task.provider) },
    { key: "tool-calls", label: t("Tool calls"), value: show(task.toolCalls) },
    { key: "retries", label: t("Retries"), value: show(task.retries) },
    {
      key: "tokens",
      label: t("Tokens"),
      value:
        task.inputTokens === undefined && task.outputTokens === undefined
          ? "—"
          : t("{{input}} in · {{output}} out", {
              input: compactTokens(task.inputTokens ?? 0),
              output: compactTokens(task.outputTokens ?? 0),
            }),
    },
    { key: "cost", label: t("Cost"), value: formatCost(task.cost) },
    {
      key: "started",
      label: t("Started"),
      value: task.startedAt === undefined ? "—" : new Date(task.startedAt).toLocaleString(),
    },
    {
      key: "ended",
      label: t("Ended"),
      value: task.endedAt === undefined ? "—" : new Date(task.endedAt).toLocaleString(),
    },
  ];
}

function TaskOutput({ task, tasks }: { task: RunTaskView; tasks: RunTaskView[] }) {
  const { t } = useTranslation();
  if (task.output || task.error || task.toolResults?.length) {
    return (
      <div className="RunTranscriptBody">
        {task.output || task.error ? <AssistantMarkdown content={task.output || task.error || ""} /> : null}
        {task.toolResults?.map((result) => (
          <ToolCard
            key={result.toolCallId}
            tool={result.tool}
            title={toolTitle(result.tool, result.args, t, result.title)}
            args={result.args}
            status={result.ok ? "complete" : "error"}
            ok={result.ok}
            result={result.result}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="RunTranscriptBody">
      <div className="RunTranscriptWaiting">
        <Spinner size={16} />
        <div className="RunTranscriptWaitingText">
          <p className="RunTranscriptWaitingTitle">
            {task.status === "pending" ? t("Queued — waiting to start") : t("Working — no output reported yet…")}
          </p>
          {task.description ? <p className="RunTranscriptHint">{task.description}</p> : null}
          {task.dependsOn.length > 0 ? (
            <p className="RunTranscriptHint">
              {t("Depends on: {{deps}}", {
                deps: task.dependsOn
                  .map((id) => tasks.find((candidate) => candidate.id === id)?.title ?? id)
                  .join(", "),
              })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function TaskEvidencePanel({ task, tasks, spans }: TaskEvidencePanelProps) {
  const { t } = useTranslation();
  const taskSpans = useMemo(() => (task ? spans.filter((span) => span.taskId === task.id) : []), [spans, task]);
  if (!task) {
    return (
      <section className="RunPanel RunEvidence">
        <NonIdealState
          icon={IconNames.SELECTION}
          title={t("Select a task")}
          description={t("Choose a node to inspect its output and runtime evidence.")}
        />
      </section>
    );
  }

  return (
    <section className="RunPanel RunTranscript RunEvidence">
      <div className="RunPanelHead">
        <span className="RunTaskDot" data-status={task.status} />
        <span>{task.title}</span>
        <span className="RunPanelHeadSub">{task.agent}</span>
      </div>
      <InspectTabs
        dataScreen="ai.run.task-evidence"
        sections={[
          {
            id: "output",
            label: t("Output"),
            icon: IconNames.ALIGN_LEFT,
            body: <TaskOutput task={task} tasks={tasks} />,
          },
          {
            id: "details",
            label: t("Details"),
            icon: IconNames.PROPERTIES,
            body: (
              <PropertyValueTable
                rows={evidenceRows(task, taskSpans, t)}
                dataTable="run.task-evidence"
                sortable={false}
              />
            ),
          },
          {
            id: "raw",
            label: t("Raw"),
            icon: IconNames.CODE,
            count: taskSpans.length,
            body: <JsonTreeView data={{ task, spans: taskSpans }} className="RunEvidenceRaw" />,
          },
        ]}
      />
    </section>
  );
}
