// ONE goal run. A goal is decomposed by a coordinator into a task DAG, you approve the plan, then workers run in
// parallel through the same tools (and the same approval gate) the Assistant uses. The whole projection arrives
// as RunEventEnvelopes folded by the shared reduceRunEvent, so this screen is pure presentation over goalClient
// state.
//
// The run is named by the route, and the client is the app-wide singleton — so this screen attaches to a run
// someone else started (the Goals list) rather than owning one. Starting a goal lives in the list's create
// drawer; this screen never creates.
import { Button, Callout, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { RunApprovalView, RunTaskView, RunView } from "@/ai-system/core/runEvents";
import { emptyRunView, runTaskWaves } from "@/ai-system/core/runReducer";
import { isRunActive } from "@/ai-system/ui/core/stores/goalClient";
import i18n from "@/i18n";
import { useRouteParams } from "@/web-app/Navigator";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from "../ScreenHeader";
import { useGoalClient } from "./goalClientInstance";
import { goToGoals } from "./Navigation";

import "./RunScreen.css";

export const ID = "ai.goal";
export const Title = i18n.t("Goal");

function compactTokens(value: number): string {
  return value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value);
}

const TaskNode: React.FC<{
  task: RunTaskView;
  selected: boolean;
  onSelect: () => void;
}> = ({ task, selected, onSelect }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="GoalTask"
      data-status={task.status}
      data-selected={selected ? "yes" : "no"}
      onClick={onSelect}
      title={task.description}
    >
      <span className="GoalTaskTitle">
        <span className="GoalTaskDot" data-status={task.status} />
        {task.title}
      </span>
      <span className="GoalTaskMeta">
        <span className="GoalTaskState" data-status={task.status}>
          {t(task.status)}
        </span>
        <span className="GoalTaskAgent">{task.agent}</span>
      </span>
    </button>
  );
};

const ApprovalPrompt: React.FC<{
  approval: RunApprovalView;
  taskTitle: string;
  onResolve: (decision: "allow" | "reject") => void;
}> = ({ approval, taskTitle, onResolve }) => {
  const { t } = useTranslation();
  return (
    <Callout className="GoalApproval" intent={Intent.WARNING} icon={IconNames.LOCK}>
      <div className="GoalApprovalBody">
        <div className="GoalApprovalText">
          <strong>{approval.title}</strong>
          <span className="GoalApprovalWhere">{t("requested by {{task}}", { task: taskTitle })}</span>
          <code>{JSON.stringify(approval.args)}</code>
        </div>
        <div className="GoalApprovalActions">
          <Button variant="minimal" text={t("Reject")} onClick={() => onResolve("reject")} />
          <Button intent={Intent.PRIMARY} icon={IconNames.TICK} text={t("Allow")} onClick={() => onResolve("allow")} />
        </div>
      </div>
    </Callout>
  );
};

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { runId } = useRouteParams<{ runId: string }>();
  const { goalClient, state } = useGoalClient();
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);

  const stored = runId ? state.runs[runId] : undefined;
  const view: RunView = stored ?? emptyRunView(runId ?? "", "");
  const active = isRunActive(view);
  const waves = useMemo(() => runTaskWaves(view.tasks), [view.tasks]);
  const pendingApprovals = view.approvals.filter((approval) => approval.status === "pending");
  // Follow the run: keep the transcript on whatever the user picked, otherwise track the newest active task so the
  // panel is never empty and never stale while work moves across the graph.
  const focusedTask =
    view.tasks.find((task) => task.id === selectedTaskId) ??
    view.tasks.find((task) => task.status === "awaiting-approval") ??
    view.tasks.find((task) => task.status === "running") ??
    view.tasks[0];

  const spent = view.usage.inputTokens + view.usage.outputTokens;
  const rightContent = (
    <div className="GoalHeaderRight">
      <span className="GoalUsage" title={t("Tokens spent by this run")}>
        {compactTokens(spent)}
      </span>
      {active ? (
        <Button
          variant="minimal"
          icon={IconNames.STOP}
          text={t("Stop")}
          onClick={() => runId && goalClient.stop(runId)}
        />
      ) : null}
      <Button variant="minimal" icon={IconNames.ARROW_LEFT} text={t("All goals")} onClick={goToGoals} />
    </div>
  );

  // A run id that is not in the store is not an error: the host may still be replaying it after a reload, and a
  // dismissed run legitimately vanishes. Say so and offer the way back rather than rendering an empty graph.
  if (!stored) {
    return (
      <div className="AppScreen" data-screen={ID}>
        <ScreenHeader currentScreen={ID} titleText={Title} rightContent={rightContent} />
        <div className="AppScreenContent GoalScreenContent">
          <NonIdealState
            icon={IconNames.GRAPH}
            title={t("This goal is no longer running")}
            description={t("Goal runs are live only — they are not kept once dismissed or after the app restarts.")}
            action={
              <Button intent={Intent.PRIMARY} icon={IconNames.ARROW_LEFT} text={t("All goals")} onClick={goToGoals} />
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader currentScreen={ID} titleText={Title} rightContent={rightContent} />
      <div className="AppScreenContent GoalScreenContent">
        <div className="GoalRunBar">
          <span className="GoalRunGoal">{view.goal}</span>
          <span className="GoalPhase" data-phase={view.phase}>
            {t(view.phase)}
          </span>
        </div>

        {state.error ? <Callout intent={Intent.DANGER}>{state.error}</Callout> : null}

        {view.planPending ? (
          <div className="GoalPlanGate">
            <div className="GoalPlanGateHead">
              <span className="bp6-icon bp6-icon-confirm" />
              <strong>{t("Plan ready — approve before anything runs")}</strong>
              <span className="GoalPlanGateCount">{t("{{count}} tasks", { count: view.tasks.length })}</span>
            </div>
            <ol className="GoalPlanList">
              {view.tasks.map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  <span className="GoalPlanDeps">
                    {task.agent}
                    {task.dependsOn.length > 0
                      ? ` · ${t("after {{deps}}", { deps: task.dependsOn.join(", ") })}`
                      : ` · ${t("no dependencies")}`}
                  </span>
                </li>
              ))}
            </ol>
            <div className="GoalPlanGateActions">
              <Button
                variant="minimal"
                text={t("Reject")}
                onClick={() => runId && goalClient.approvePlan(runId, "reject")}
              />
              <Button
                intent={Intent.PRIMARY}
                icon={IconNames.TICK}
                text={t("Approve plan")}
                onClick={() => runId && goalClient.approvePlan(runId, "allow")}
              />
            </div>
          </div>
        ) : null}

        {pendingApprovals.map((approval) => (
          <ApprovalPrompt
            key={approval.approvalId}
            approval={approval}
            taskTitle={view.tasks.find((task) => task.id === approval.taskId)?.title ?? approval.taskId}
            onResolve={(decision) => runId && goalClient.approveTool(runId, approval.approvalId, decision)}
          />
        ))}

        {view.tasks.length > 0 ? (
          <div className="GoalWorkspace">
            <section className="GoalPanel GoalGraph">
              <div className="GoalPanelHead">
                <span className="bp6-icon bp6-icon-graph" />
                <span>{t("Task graph")}</span>
              </div>
              <div className="GoalGraphBody">
                {waves.map((wave, index) => (
                  <div className="GoalWave" key={wave.map((task) => task.id).join("-")}>
                    <div className="GoalWaveLabel">
                      {index === 0 ? t("Wave 1 — parallel") : t("Wave {{n}}", { n: index + 1 })}
                    </div>
                    {wave.map((task) => (
                      <TaskNode
                        key={task.id}
                        task={task}
                        selected={focusedTask?.id === task.id}
                        onSelect={() => setSelectedTaskId(task.id)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </section>

            <section className="GoalPanel GoalTranscript">
              <div className="GoalPanelHead">
                <span className="GoalTaskDot" data-status={focusedTask?.status ?? "pending"} />
                <span>{focusedTask?.title ?? t("No task selected")}</span>
                <span className="GoalPanelHeadSub">{focusedTask?.agent}</span>
              </div>
              <pre className="GoalTranscriptBody">
                {focusedTask?.output || focusedTask?.error || t("Waiting for this agent to report…")}
              </pre>
            </section>
          </div>
        ) : null}

        {view.synthesis ? (
          <section className="GoalPanel GoalSynthesis">
            <div className="GoalPanelHead">
              <span className="bp6-icon bp6-icon-endorsed" />
              <span>{t("Answer")}</span>
            </div>
            <div className="GoalSynthesisBody">{view.synthesis}</div>
          </section>
        ) : null}

        {view.tasks.length === 0 && !view.planPending ? (
          <NonIdealState
            icon={IconNames.GRAPH}
            title={t("Planning…")}
            description={t("The coordinator is breaking your goal into tasks.")}
          />
        ) : null}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/ai/goal/$runId",
};
Screen.Metadata = {
  LeftIcon: IconNames.GRAPH,
  // Deliberately NOT RequiresAI: the AI menu lists screens you can navigate to cold, and this one needs a run id.
  // The Goals list is the entry point; this is its detail.
  ExcludeFromSidebar: true,
};
