// The drawer behind pi's own `/settings`, `/trust` and `/scoped-models`. Each answers with the state it is about
// when given no argument, and writes when given one. All three land here because they are one question — how is this
// session set up — and splitting them across three surfaces would make the user hunt for settings pi keeps together.
//
// Whichever command opened it, the drawer reads the other two, and every write re-reads from the answer rather than
// assuming it landed: pi keeps some of these on the session and some in its settings file, and the session is the
// only authority on what they now are.

import { Button, ButtonGroup, Callout, Checkbox, Classes, Intent, Switch, Tag } from "@blueprintjs/core";
import { DrawerSize } from "@blueprintjs/core/lib/esm/components/drawer/drawer";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  readProjectTrustAnswer,
  readScopedModelsAnswer,
  readSessionSettingsAnswer,
} from "@/ai-system/ui/core/commands/piCommandAnswers";
import type { PiCommandResult, PiProjectTrust, PiScopedModels, PiSessionSettings } from "@/pi-bridge/protocol";
import { AppDrawer } from "@/web-app/components/AppDrawer";

import "./AssistantSettingsDrawer.css";

// What the command that opened the drawer answered with. The rest is read once it is open.
export type AssistantSettingsView =
  | { kind: "settings"; settings: PiSessionSettings }
  | { kind: "trust"; trust: PiProjectTrust }
  | { kind: "scoped-models"; models: PiScopedModels };

interface AssistantSettingsDrawerProps {
  view: AssistantSettingsView;
  // Runs one of pi's own commands again — bare to read, with an argument to write. The result is pi's, refusals
  // included, so the drawer reports the session's own words rather than inventing them.
  onRun: (name: string, args: string) => Promise<PiCommandResult>;
  onClose: () => void;
}

const QUEUE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "one-at-a-time", label: "One at a time" },
] as const;

// pi's own level names, capitalised for a control. Anything pi adds later shows under its own name. `off` is on the
// list for every model that can be asked not to reason, and the two above high are offered only by a model whose
// provider published them.
const LEVEL_LABELS: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
};

function ChoiceRow<T extends string>({
  text,
  choice,
  disabled,
  onPick,
}: {
  text: { label: string; hint?: string };
  choice: { value: T; options: readonly { value: T; label: string }[] };
  disabled: boolean;
  onPick: (value: T) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="AssistantSettingsRow">
      <div>
        <strong>{t(text.label)}</strong>
        {text.hint ? <small>{t(text.hint)}</small> : null}
      </div>
      <ButtonGroup className="AssistantSettingsChoice">
        {choice.options.map((option) => (
          <Button
            key={option.value}
            size="small"
            active={option.value === choice.value}
            intent={option.value === choice.value ? Intent.PRIMARY : Intent.NONE}
            disabled={disabled}
            onClick={() => onPick(option.value)}
          >
            {t(option.label)}
          </Button>
        ))}
      </ButtonGroup>
    </div>
  );
}

function PanelHeader({ title, tag }: { title: string; tag?: string }) {
  const { t } = useTranslation();
  return (
    <div className="AssistantSettingsPanelHeader">
      <h5>{t(title)}</h5>
      {tag ? <Tag minimal>{t(tag)}</Tag> : null}
    </div>
  );
}

export function AssistantSettingsDrawer({ view, onRun, onClose }: AssistantSettingsDrawerProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(view.kind === "settings" ? view.settings : undefined);
  const [trust, setTrust] = useState(view.kind === "trust" ? view.trust : undefined);
  const [models, setModels] = useState(view.kind === "scoped-models" ? view.models : undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Read whatever the opening command did not answer with. A read that fails is reported like any other refusal —
  // a panel that silently renders nothing would look like the session has no such setting.
  useEffect(() => {
    let live = true;
    const read = async () => {
      const wanted: Array<[string, (result: PiCommandResult) => void]> = [];
      if (view.kind !== "settings")
        wanted.push(["settings", (r) => r.ok && setSettings(readSessionSettingsAnswer(r.data))]);
      if (view.kind !== "trust") wanted.push(["trust", (r) => r.ok && setTrust(readProjectTrustAnswer(r.data))]);
      if (view.kind !== "scoped-models") {
        wanted.push(["scoped-models", (r) => r.ok && setModels(readScopedModelsAnswer(r.data))]);
      }
      for (const [name, apply] of wanted) {
        const result = await onRun(name, "");
        if (!live) return;
        if (result.ok) apply(result);
        else setError(result.error);
      }
    };
    void read();
    return () => {
      live = false;
    };
  }, [view.kind, onRun]);

  // Every write goes back through pi's own command and adopts what it answered, so the drawer cannot drift from the
  // session — including when pi clamps or refuses the value.
  const write = async (name: string, args: string, apply: (result: PiCommandResult) => void) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await onRun(name, args);
      if (result.ok) apply(result);
      else setError(result.error);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const writeSetting = (key: string, value: string) =>
    void write("settings", `${key} ${value}`, (result) => {
      if (result.ok) setSettings(readSessionSettingsAnswer(result.data) ?? settings);
    });

  const writeTrust = (decision: "on" | "off") =>
    void write("trust", decision, (result) => {
      if (result.ok) setTrust(readProjectTrustAnswer(result.data) ?? trust);
    });

  // Scoping nothing is how pi says "cycle everything", which is what `all` widens back to.
  const writeScoped = (ids: readonly string[]) =>
    void write("scoped-models", ids.length ? ids.join(" ") : "all", (result) => {
      if (result.ok) setModels(readScopedModelsAnswer(result.data) ?? models);
    });

  const levels = settings?.availableThinkingLevels ?? [];

  return (
    <AppDrawer
      className="AssistantSettingsDrawer"
      icon={IconNames.COG}
      title={t("Session settings")}
      size={DrawerSize.SMALL}
      onClose={onClose}
    >
      <div className={Classes.DRAWER_BODY} data-testid="assistant-settings-drawer">
        <div className={Classes.DIALOG_BODY}>
          {error ? <Callout intent={Intent.DANGER}>{error}</Callout> : null}

          <section className="AssistantSettingsPanel">
            <PanelHeader title="Conversation" tag="this session" />
            {settings ? (
              <>
                <div className="AssistantSettingsRow">
                  <div>
                    <strong>{t("Auto-compaction")}</strong>
                    <small>{t("Summarise the oldest turns when the context window fills")}</small>
                  </div>
                  <Switch
                    checked={settings.autoCompaction}
                    disabled={busy}
                    aria-label={t("Auto-compaction")}
                    onChange={() => writeSetting("autoCompaction", settings.autoCompaction ? "off" : "on")}
                  />
                </div>
                {levels.length ? (
                  <ChoiceRow
                    text={{ label: "Thinking level", hint: "How much this model reasons first" }}
                    choice={{
                      value: settings.thinkingLevel,
                      options: levels.map((level) => ({ value: level, label: LEVEL_LABELS[level] ?? level })),
                    }}
                    disabled={busy}
                    onPick={(level) => writeSetting("thinkingLevel", level)}
                  />
                ) : (
                  <div className="AssistantSettingsNotice">
                    {t("This model does not reason, so there is no level to set.")}
                  </div>
                )}
              </>
            ) : (
              <div className="AssistantSettingsNotice">{t("Reading the session's settings…")}</div>
            )}
          </section>

          {settings ? (
            <section className="AssistantSettingsPanel">
              <PanelHeader title="While the agent is working" />
              <ChoiceRow
                text={{ label: "Steering", hint: "Sending into a turn already running" }}
                choice={{ value: settings.steeringMode, options: QUEUE_OPTIONS }}
                disabled={busy}
                onPick={(mode) => writeSetting("steeringMode", mode)}
              />
              <ChoiceRow
                text={{ label: "Follow-ups", hint: "Queued messages picked up after a turn" }}
                choice={{ value: settings.followUpMode, options: QUEUE_OPTIONS }}
                disabled={busy}
                onPick={(mode) => writeSetting("followUpMode", mode)}
              />
            </section>
          ) : null}

          {trust ? (
            <section className="AssistantSettingsPanel">
              <PanelHeader
                title="Project trust"
                tag={trust.decision === null ? "never decided" : trust.decision ? "trusted" : "not trusted"}
              />
              <ChoiceRow
                text={{
                  label: "This workspace",
                  // `decision: null` is not a decided no, and the agent treats it as untrusted meanwhile — saying
                  // so is the difference between "you chose this" and "nobody has chosen yet".
                  hint:
                    trust.decision === null
                      ? "You have not decided yet — the agent is treating it as untrusted"
                      : "Stored with the agent, never written into your folder",
                }}
                choice={{
                  value: trust.decision === true ? "on" : trust.decision === false ? "off" : "",
                  options: [
                    { value: "on", label: "Trusted" },
                    { value: "off", label: "Not trusted" },
                  ],
                }}
                disabled={busy}
                onPick={(decision) => writeTrust(decision === "on" ? "on" : "off")}
              />
              <div className="AssistantSettingsRow">
                <div>
                  <span className="AssistantSettingsPath" title={trust.path}>
                    {trust.path}
                  </span>
                </div>
                <Tag minimal>{trust.matters ? t("gates skills + .pi") : t("gates nothing here")}</Tag>
              </div>
            </section>
          ) : null}

          {models ? (
            <section className="AssistantSettingsPanel">
              <PanelHeader title="Models it cycles" />
              {models.available.map((model) => {
                const scoped = models.scoped.includes(model.id);
                return (
                  <div className="AssistantSettingsRow" key={model.id}>
                    <div>
                      <strong>{model.name || model.id}</strong>
                      <small>{model.provider}</small>
                    </div>
                    <Checkbox
                      checked={scoped}
                      disabled={busy}
                      aria-label={model.name || model.id}
                      onChange={() =>
                        writeScoped(
                          scoped ? models.scoped.filter((id) => id !== model.id) : [...models.scoped, model.id],
                        )
                      }
                    />
                  </div>
                );
              })}
              <div className="AssistantSettingsNotice">
                {models.scoped.length
                  ? t("{{scoped}} of {{total}} scoped for Ctrl+P.", {
                      scoped: models.scoped.length,
                      total: models.available.length,
                    })
                  : // The count is the point: "everything" is the models this session has been pointed at, which
                    // grows by one each time the user picks another.
                    t("Nothing is scoped, so Ctrl+P cycles all {{total}} of this session's models.", {
                      total: models.available.length,
                    })}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </AppDrawer>
  );
}
