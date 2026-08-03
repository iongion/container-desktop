// ONE team run. A goal is decomposed by a coordinator into a task DAG, you approve the plan, then Workers run in
// parallel through the same tools (and the same approval gate) the Assistant uses. The whole projection arrives
// as RunEventEnvelopes folded by the shared reduceRunEvent, so this screen is pure presentation over runClient
// state.
//
// The run is named by the route, and the client is the app-wide singleton — so this screen attaches to a run
// someone else started (the Runs list) rather than owning one. Starting a run lives in the list's create
// drawer; this screen never creates.
import {
  Button,
  ButtonGroup,
  Callout,
  Classes,
  FormGroup,
  Icon,
  Intent,
  Menu,
  NonIdealState,
  PopoverNext,
  ProgressBar,
  Spinner,
} from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pane, SplitPane } from "react-split-pane";

import { DEFAULT_RUN_TOKEN_BUDGET } from "@/ai-system/core/limits";
import type { RunApprovalView, RunView } from "@/ai-system/core/runEvents";
import { emptyRunView, runTaskWaves } from "@/ai-system/core/runReducer";
import { isRunActive } from "@/ai-system/ui/core/stores/runClient";
import { toolTitle } from "@/ai-system/ui/core/toolTitle";
import i18n from "@/i18n";
import { randomUUID } from "@/utils/randomUUID";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { AssistantMarkdown } from "@/web-app/components/ai/AssistantMarkdown";
import { ConfirmMenuItem } from "@/web-app/components/ConfirmMenu";
import { useRouteParams } from "@/web-app/Navigator";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { compactTokens } from "@/web-app/utils/format";
import { ScreenHeader } from "../ScreenHeader";
import { runGraphEdges } from "./dagEdges";
import { getRunsUrl, goToRun, goToRuns } from "./Navigation";
import { RunGraphPanel } from "./RunGraphCanvas";
import { RunStatStrip } from "./RunStatStrip";
import { isPlanningStage } from "./runBoard";
import { useRunClient } from "./runClientInstance";
import { TaskEvidencePanel } from "./TaskEvidencePanel";
import { WaterfallView } from "./WaterfallView";

// A run-level failure is never a bare "ERROR": each scope gets a plain-language heading, and the exact message
// (provider text, plan-parse reason, transport error) is always shown verbatim below it.
function errorTitle(scope: NonNullable<RunView["error"]>["scope"]): string {
  switch (scope) {
    case "start":
      return i18n.t("The run could not start");
    case "plan":
      return i18n.t("Planning failed");
    case "synthesis":
      return i18n.t("Synthesis failed");
    case "task":
      return i18n.t("A task failed");
    default:
      return i18n.t("The run failed");
  }
}

import "./RunScreen.css";

export const ID = "ai.run";
export const Title = i18n.t("Run");

const ApprovalPrompt: React.FC<{
  approval: RunApprovalView;
  taskTitle: string;
  onResolve: (decision: "allow" | "reject") => void;
}> = ({ approval, taskTitle, onResolve }) => {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const formId = useId();
  const title = toolTitle(approval.tool, approval.args, t, approval.title);
  const resolve = (decision: "allow" | "reject") => {
    setDetailsOpen(false);
    onResolve(decision);
  };

  return (
    <>
      <section className="RunApproval" aria-label={title}>
        <div className="RunApprovalBody">
          <div className="RunApprovalText">
            <strong>{title}</strong>
            <span className="RunApprovalWhere">{t("requested by {{task}}", { task: taskTitle })}</span>
          </div>
          <div className="RunApprovalActions">
            <Button
              variant="minimal"
              size="small"
              icon={IconNames.LIST_DETAIL_VIEW}
              text={t("Details")}
              onClick={() => setDetailsOpen(true)}
            />
            <Button variant="minimal" size="small" text={t("Reject")} onClick={() => resolve("reject")} />
            <Button
              intent={Intent.WARNING}
              size="small"
              icon={IconNames.TICK}
              text={t("Allow")}
              onClick={() => resolve("allow")}
            />
          </div>
        </div>
      </section>
      {detailsOpen ? (
        <AppDrawer
          className="RunApprovalDrawer"
          icon={IconNames.LOCK}
          title={title}
          size={DrawerSize.SMALL}
          onClose={() => setDetailsOpen(false)}
          formId={formId}
          submitIcon={IconNames.TICK}
          submitTitle={t("Allow")}
        >
          <div className={Classes.DRAWER_BODY}>
            <form
              id={formId}
              className={Classes.DIALOG_BODY}
              onSubmit={(event) => {
                event.preventDefault();
                resolve("allow");
              }}
            >
              <div className="AppDataForm RunApprovalDrawerForm">
                <div className="RunApprovalDrawerContext">{t("requested by {{task}}", { task: taskTitle })}</div>
                <FormGroup label={t("Reason")}>
                  <div className="RunApprovalDrawerReason">{approval.reason}</div>
                </FormGroup>
                <FormGroup label={t("Request body")}>
                  <pre className="RunApprovalDrawerPayload">
                    <code>{JSON.stringify(approval.args, null, 2)}</code>
                  </pre>
                </FormGroup>
              </div>
              <ButtonGroup fill className="RunApprovalDrawerActions">
                <Button type="button" icon={IconNames.CROSS} text={t("Reject")} onClick={() => resolve("reject")} />
                <Button type="submit" intent={Intent.WARNING} icon={IconNames.TICK} text={t("Allow")} />
              </ButtonGroup>
            </form>
          </div>
        </AppDrawer>
      ) : null}
    </>
  );
};

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { runId } = useRouteParams<{ runId: string }>();
  const { runClient, state } = useRunClient();
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"dag" | "waterfall">("dag");

  const stored = runId ? state.runs[runId] : undefined;
  const view: RunView = stored ?? emptyRunView(runId ?? "", "");
  const active = isRunActive(view);
  const waves = useMemo(() => runTaskWaves(view.tasks), [view.tasks]);
  const edges = useMemo(() => runGraphEdges(view.tasks), [view.tasks]);
  const pendingApprovals = view.approvals.filter((approval) => approval.status === "pending");
  // Follow the run: keep the transcript on whatever the user picked, otherwise track the newest active task so the
  // panel is never empty and never stale while work moves across the graph.
  const focusedTask =
    view.tasks.find((task) => task.id === selectedTaskId) ??
    view.tasks.find((task) => task.status === "awaiting-approval") ??
    view.tasks.find((task) => task.status === "running") ??
    view.tasks[0];

  const spent = view.usage.inputTokens + view.usage.outputTokens;
  // The cap the budget is spent against — the run's own maxTokens once a usage event has carried it, else the
  // default. A real denominator, so the bar reads "spent of what's actually available", not a guess.
  const budget = view.maxTokens ?? DEFAULT_RUN_TOKEN_BUDGET;
  const usageFraction = budget > 0 ? Math.min(1, spent / budget) : 0;
  const usageIntent = usageFraction >= 1 ? Intent.DANGER : usageFraction >= 0.8 ? Intent.WARNING : Intent.PRIMARY;
  const viewSwitch = (
    <ButtonGroup className="RunViewMode" aria-label={t("Run view")}>
      <Button
        active={viewMode === "dag"}
        size="small"
        icon={IconNames.GRAPH}
        text={t("DAG")}
        onClick={() => setViewMode("dag")}
      />
      <Button
        active={viewMode === "waterfall"}
        size="small"
        icon={IconNames.TIMELINE_BAR_CHART}
        text={t("Waterfall")}
        onClick={() => setViewMode("waterfall")}
      />
    </ButtonGroup>
  );
  const rightContent = (
    <div className="RunHeaderRight">
      <div
        className="RunUsage"
        title={t("{{spent}} of {{budget}} tokens used ({{percent}}%)", {
          spent,
          budget,
          percent: Math.round(usageFraction * 100),
        })}
      >
        <div className="RunUsageMeter">
          <ProgressBar value={usageFraction} intent={usageIntent} stripes={active} animate={active} />
        </div>
        <span className="RunUsageLabel">
          {compactTokens(spent)} / {compactTokens(budget)} · {Math.round(usageFraction * 100)}%
        </span>
      </div>
      <Button
        variant="minimal"
        icon={IconNames.STOP}
        text={t("Stop")}
        disabled={!active}
        onClick={() => runId && runClient.stop(runId)}
      />
    </div>
  );

  // Re-run the same goal as a fresh run (new id, default provider/settings), then follow it — the way out of a
  // failed run that keeps the user moving instead of stranding them on a dead screen.
  const retry = () => {
    const nextId = randomUUID();
    runClient.start({ runId: nextId, goal: view.goal });
    goToRun(nextId);
  };
  const dismiss = () => {
    if (runId) runClient.dismiss(runId);
    goToRuns();
  };

  const errorPanel = view.error ? (
    <Callout className="RunError" intent={Intent.DANGER} icon={IconNames.ERROR} title={errorTitle(view.error.scope)}>
      <pre className="RunErrorMessage">{view.error.message}</pre>
      <div className="RunErrorActions">
        <Button intent={Intent.PRIMARY} icon={IconNames.REFRESH} text={t("Retry")} onClick={retry} />
        <Button icon={IconNames.CROSS} text={t("Dismiss")} onClick={dismiss} />
      </div>
    </Callout>
  ) : null;

  // A run id that is not in the store is not an error: the host may still be replaying it after a reload, and a
  // dismissed run legitimately vanishes. Say so and offer the way back rather than rendering an empty graph.
  if (!stored) {
    return (
      <div className="AppScreen" data-screen={ID}>
        <ScreenHeader
          currentScreen={ID}
          withBack
          listRoutePath={getRunsUrl()}
          listRouteIcon={IconNames.GRAPH}
          rightContent={rightContent}
        />
        <div className="AppScreenContent RunScreenContent">
          <NonIdealState
            icon={IconNames.GRAPH}
            title={t("This run is no longer available")}
            description={t("Runs are live only — they are not kept once dismissed or after the app restarts.")}
            action={
              <Button intent={Intent.PRIMARY} icon={IconNames.ARROW_LEFT} text={t("All runs")} onClick={goToRuns} />
            }
          />
        </div>
      </div>
    );
  }

  const graphPanel =
    viewMode === "dag" ? (
      <RunGraphPanel
        waves={waves}
        edges={edges}
        focusedTaskId={focusedTask?.id}
        onSelect={setSelectedTaskId}
        viewSwitch={viewSwitch}
      />
    ) : (
      <WaterfallView
        spans={view.spans}
        droppedSpanRecords={view.droppedSpanRecords}
        onSelectTask={setSelectedTaskId}
        viewSwitch={viewSwitch}
      />
    );

  const transcriptPanel = <TaskEvidencePanel task={focusedTask} tasks={view.tasks} spans={view.spans} />;

  const synthesisPanel = (
    <section className="RunPanel RunSynthesis">
      <div className="RunPanelHead">
        <span className="bp6-icon bp6-icon-endorsed" />
        <span>{t("Answer")}</span>
      </div>
      <div className="RunSynthesisBody">
        <AssistantMarkdown content={view.synthesis} />
      </div>
    </section>
  );

  // The task graph, its transcript, and the answer are resizable so each user can weight them to taste. The graph
  // and transcript split horizontally; when an answer exists it takes the lower half of a vertical split.
  const graphAndTranscript = (
    <SplitPane direction="horizontal" dividerSize={8} className="RunSplit">
      <Pane defaultSize="46%" minSize="220px">
        {graphPanel}
      </Pane>
      <Pane minSize="280px">{transcriptPanel}</Pane>
    </SplitPane>
  );

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader
        currentScreen={ID}
        withBack
        listRoutePath={getRunsUrl()}
        listRouteIcon={IconNames.GRAPH}
        rightContent={rightContent}
      />
      <div className="AppScreenContent RunScreenContent">
        <div className="RunBar">
          <span className="RunGoal">{view.goal}</span>
          <span className="RunPhase" data-phase={view.phase}>
            {t(view.phase)}
          </span>
        </div>

        <RunStatStrip view={view} />

        {state.error ? <Callout intent={Intent.DANGER}>{state.error}</Callout> : null}

        {errorPanel}

        {view.planPending ? (
          <div className="RunPlanGate">
            <div className="RunPlanGateHead">
              <span className="bp6-icon bp6-icon-confirm" />
              <strong>{t("Plan ready — approve before anything runs")}</strong>
              <span className="RunPlanGateCount">{t("{{count}} tasks", { count: view.tasks.length })}</span>
              <div className="RunPlanGateActions">
                <PopoverNext
                  isOpen={rejectOpen}
                  onInteraction={setRejectOpen}
                  usePortal
                  hasBackdrop={false}
                  placement="bottom-end"
                  content={
                    <Menu>
                      <ConfirmMenuItem
                        icon={IconNames.CROSS}
                        text={t("Reject plan")}
                        intent={Intent.DANGER}
                        onConfirm={() => {
                          setRejectOpen(false);
                          if (runId) runClient.approvePlan(runId, "reject");
                        }}
                        onCancel={() => setRejectOpen(false)}
                      />
                    </Menu>
                  }
                >
                  <Button variant="minimal" size="small" text={t("Reject")} onClick={() => setRejectOpen((v) => !v)} />
                </PopoverNext>
                <Button
                  intent={Intent.PRIMARY}
                  size="small"
                  icon={IconNames.TICK}
                  text={t("Approve plan")}
                  onClick={() => runId && runClient.approvePlan(runId, "allow")}
                />
              </div>
            </div>
            <ol className="RunPlanList">
              {view.tasks.map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  <span className="RunPlanDeps">
                    {task.agent}
                    {task.dependsOn.length > 0
                      ? ` · ${t("after {{deps}}", { deps: task.dependsOn.join(", ") })}`
                      : ` · ${t("no dependencies")}`}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {pendingApprovals.length > 0 ? (
          <section className="RunApprovals" aria-label={t("Awaiting approval")}>
            <div className="RunApprovalQueueHeader">
              <span className="RunApprovalQueueTitle">
                <Icon icon={IconNames.LOCK} size={14} />
                <strong>{t("Awaiting approval")}</strong>
              </span>
              <span className="RunApprovalQueueCount">
                {pendingApprovals.length} {t("pending")}
              </span>
            </div>
            <div className="RunApprovalList">
              {pendingApprovals.map((approval) => (
                <ApprovalPrompt
                  key={approval.approvalId}
                  approval={approval}
                  taskTitle={view.tasks.find((task) => task.id === approval.taskId)?.title ?? approval.taskId}
                  onResolve={(decision) => runId && runClient.approveTool(runId, approval.approvalId, decision)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {view.tasks.length > 0 ? (
          <div className="RunWorkspace">
            {view.synthesis ? (
              <SplitPane direction="vertical" dividerSize={8} className="RunSplit">
                <Pane defaultSize="62%" minSize="180px">
                  {graphAndTranscript}
                </Pane>
                <Pane minSize="120px">{synthesisPanel}</Pane>
              </SplitPane>
            ) : (
              graphAndTranscript
            )}
          </div>
        ) : view.synthesis ? (
          <div className="RunWorkspace RunWorkspace--answerOnly">{synthesisPanel}</div>
        ) : null}

        {view.tasks.length === 0 && !view.planPending && !view.error && isPlanningStage(view.phase) ? (
          <NonIdealState
            icon={<Spinner size={28} />}
            title={t("Planning…")}
            description={t("The coordinator is breaking your goal into tasks — {{spent}} tokens used so far.", {
              spent: compactTokens(spent),
            })}
          />
        ) : null}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/ai/run/$runId",
};
Screen.Metadata = {
  LeftIcon: IconNames.GRAPH,
  // Deliberately NOT RequiresAI: the AI menu lists screens you can navigate to cold, and this one needs a run id.
  // The Runs list is the entry point; this is its detail.
  ExcludeFromSidebar: true,
};
