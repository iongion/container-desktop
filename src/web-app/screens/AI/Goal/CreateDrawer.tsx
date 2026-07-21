// Starting a goal: the text, its token budget, and an optional worker roster.
//
// The roster is OPTIONAL by design — with none selected the run behaves exactly as it did before workers existed
// (one model, one prompt, one toolset for every task). Choosing workers hands the coordinator a roster it must
// assign every task from, which is why the wire carries ids only: the host resolves each definition and its
// provider, so a renderer can never name a tool policy inline.

import {
  Button,
  ButtonGroup,
  Callout,
  Checkbox,
  Classes,
  FormGroup,
  H5,
  HTMLSelect,
  Intent,
  TextArea,
} from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { DEFAULT_RUN_TOKEN_BUDGET, MAX_RUN_TASKS, MAX_RUN_WORKERS } from "@/ai-system/core/limits";
import { randomUUID } from "@/utils/randomUUID";
import { AppDrawer } from "@/web-app/components/AppDrawer";

import { useWorkers } from "../Worker/queries";
import { getGoalClient } from "./goalClientInstance";

const BUDGETS = [50_000, DEFAULT_RUN_TOKEN_BUDGET, 500_000];

function compactTokens(value: number): string {
  return value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value);
}

export interface CreateDrawerProps {
  onClose: () => void;
  onStarted: (runId: string) => void;
}

export const CreateDrawer: React.FC<CreateDrawerProps> = ({ onClose, onStarted }) => {
  const { t } = useTranslation();
  const formId = useId();
  const { data: workers } = useWorkers();
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState(DEFAULT_RUN_TOKEN_BUDGET);
  const [workerIds, setWorkerIds] = useState<string[]>([]);

  const toggleWorker = useCallback((id: string) => {
    setWorkerIds((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));
  }, []);

  const atRosterCap = workerIds.length >= MAX_RUN_WORKERS;

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed) return;
    const runId = randomUUID();
    getGoalClient().start({
      runId,
      goal: trimmed,
      maxTokens: budget,
      maxTasks: MAX_RUN_TASKS,
      workerIds: workerIds.length > 0 ? workerIds : undefined,
    });
    onStarted(runId);
    onClose();
  };

  return (
    <AppDrawer
      icon={IconNames.GRAPH}
      title={t("New goal")}
      size={DrawerSize.STANDARD}
      onClose={onClose}
      formId={formId}
      submitIcon={IconNames.PLAY}
      submitTitle={t("Run goal")}
      submitDisabled={!goal.trim()}
    >
      <div className={Classes.DRAWER_BODY}>
        <form id={formId} className={Classes.DIALOG_BODY} onSubmit={onSubmit}>
          <div className="AppDataForm" data-form="ai.goal.create">
            <FormGroup label={t("Goal")} labelFor="goalText" labelInfo="(required)">
              <TextArea
                fill
                autoFocus
                required
                id="goalText"
                className="GoalCreateInput"
                rows={5}
                value={goal}
                placeholder={t("Describe what you want done — a team of agents will plan it, then run it in parallel.")}
                onChange={(event) => setGoal(event.currentTarget.value)}
              />
            </FormGroup>

            <FormGroup
              label={t("Token budget")}
              labelFor="goalBudget"
              helperText={t("Up to {{count}} tasks", { count: MAX_RUN_TASKS })}
            >
              <HTMLSelect
                id="goalBudget"
                fill
                value={budget}
                onChange={(event) => setBudget(Number(event.currentTarget.value))}
              >
                {BUDGETS.map((value) => (
                  <option key={value} value={value}>
                    {t("Budget — {{tokens}} tokens", { tokens: compactTokens(value) })}
                  </option>
                ))}
              </HTMLSelect>
            </FormGroup>

            <section className="GoalCreateRoster">
              <H5>{t("Workers")}</H5>
              {(workers ?? []).length === 0 ? (
                <Callout icon={IconNames.INFO_SIGN} className="GoalCreateNote">
                  {t("No workers defined — this goal runs with the assistant's own model and tools.")}
                </Callout>
              ) : (
                <>
                  <Callout icon={IconNames.INFO_SIGN} className="GoalCreateNote">
                    {t(
                      "Optional. Pick none and the run uses the assistant's own model and tools; pick some and the coordinator assigns every task to one of them.",
                    )}
                  </Callout>
                  {(workers ?? []).map((worker) => {
                    const checked = workerIds.includes(worker.id);
                    return (
                      <Checkbox
                        key={worker.id}
                        checked={checked}
                        // The host caps a roster; stop the user building one it would reject.
                        disabled={!checked && atRosterCap}
                        onChange={() => toggleWorker(worker.id)}
                      >
                        <span className="GoalCreateWorkerName">{worker.name}</span>
                        <span className="GoalCreateWorkerSpecialty">{worker.specialty}</span>
                      </Checkbox>
                    );
                  })}
                  {atRosterCap ? (
                    <div className="GoalCreateHint">
                      {t("At most {{count}} workers can run a single goal.", { count: MAX_RUN_WORKERS })}
                    </div>
                  ) : null}
                </>
              )}
            </section>
          </div>
          <ButtonGroup fill>
            <Button
              intent={Intent.SUCCESS}
              icon={IconNames.PLAY}
              title={t("Click to start this goal")}
              text={t("Run goal")}
              disabled={!goal.trim()}
              type="submit"
            />
          </ButtonGroup>
        </form>
      </div>
    </AppDrawer>
  );
};
