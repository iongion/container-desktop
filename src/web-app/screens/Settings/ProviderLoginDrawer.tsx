import { Button, ButtonGroup, Callout, Classes, DrawerSize, FormGroup, InputGroup, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppDrawer } from "@/web-app/components/AppDrawer";
import { useProviderLoginStore } from "@/web-app/stores/providerLogin";

import "./ProviderLoginDrawer.css";

// Provider sign-in — an AppDrawer, the same surface the registry sign-in uses, because the app never uses modal
// Dialogs. What differs is who asks the questions: pi's own login flow does, from inside a one-shot container, so
// every line here is a frame that arrived rather than copy this screen composed.
//
// The browser is where a sign-in happens, and the flow's callback server is inside a container the browser cannot
// reach — so pi's manual-paste prompt is the step that completes it. That is pi's own path for a browser on another
// machine, and a browser outside the container is exactly that.
export function ProviderLoginDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const formId = useId();
  const label = useProviderLoginStore((state) => state.label);
  const status = useProviderLoginStore((state) => state.status);
  const log = useProviderLoginStore((state) => state.log);
  const authUrl = useProviderLoginStore((state) => state.authUrl);
  const authInstructions = useProviderLoginStore((state) => state.authInstructions);
  const deviceCode = useProviderLoginStore((state) => state.deviceCode);
  const prompt = useProviderLoginStore((state) => state.prompt);
  const message = useProviderLoginStore((state) => state.message);
  const answerPrompt = useProviderLoginStore((state) => state.answerPrompt);
  const declinePrompt = useProviderLoginStore((state) => state.declinePrompt);
  const [answer, setAnswer] = useState("");

  const secret = prompt?.prompt.type === "secret";
  const canSubmit = !!prompt && (prompt.prompt.type === "select" || answer.trim().length > 0);
  const submit = () => {
    if (!canSubmit) return;
    answerPrompt(answer.trim());
    setAnswer("");
  };

  return (
    <AppDrawer
      className="ProviderLoginDrawer"
      icon={IconNames.LOG_IN}
      title={label ?? t("Sign in")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitIcon={IconNames.LOG_IN}
      submitTitle={t("Continue")}
      submitDisabled={!canSubmit}
    >
      <div className={Classes.DRAWER_BODY}>
        <form
          id={formId}
          className={Classes.DIALOG_BODY}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="AppDataForm" data-form="provider.login">
            {authUrl ? (
              <Callout intent={Intent.PRIMARY} icon={IconNames.SHARE} className="ProviderLoginAuthUrl">
                {/* An anchor, so the shell's own handler sends it to the system browser — the app opens nothing itself. */}
                <a href={authUrl} target="_blank" rel="noreferrer">
                  {t("Open the sign-in page")}
                </a>
                {authInstructions ? <p className="ProviderLoginInstructions">{authInstructions}</p> : null}
              </Callout>
            ) : null}

            {deviceCode ? (
              <FormGroup label={t("Enter this code at {{url}}", { url: deviceCode.verificationUri })}>
                <InputGroup readOnly fill value={deviceCode.userCode} leftIcon={IconNames.KEY} />
              </FormGroup>
            ) : null}

            {prompt?.prompt.type === "select" ? (
              <FormGroup label={prompt.prompt.message}>
                <ButtonGroup vertical fill>
                  {prompt.prompt.options.map((option) => (
                    <Button
                      key={option.id}
                      text={option.label}
                      title={option.description}
                      onClick={() => answerPrompt(option.id)}
                    />
                  ))}
                </ButtonGroup>
              </FormGroup>
            ) : null}

            {prompt && prompt.prompt.type !== "select" ? (
              <FormGroup label={prompt.prompt.message}>
                <InputGroup
                  fill
                  autoFocus
                  type={secret ? "password" : "text"}
                  value={answer}
                  placeholder={prompt.prompt.placeholder}
                  onChange={(event) => setAnswer(event.currentTarget.value)}
                />
              </FormGroup>
            ) : null}

            {log.length > 0 ? <div className="ProviderLoginLog">{log[log.length - 1]}</div> : null}

            {message ? (
              <Callout
                intent={status === "stored" ? Intent.SUCCESS : Intent.WARNING}
                icon={status === "stored" ? IconNames.TICK : IconNames.WARNING_SIGN}
              >
                {message}
              </Callout>
            ) : null}

            {status === "stored" ? (
              <Callout intent={Intent.SUCCESS} icon={IconNames.TICK}>
                {t("Signed in. The key is stored in the OS keychain.")}
              </Callout>
            ) : null}
          </div>

          {prompt && prompt.prompt.type !== "select" ? (
            <ButtonGroup fill>
              <Button
                type="submit"
                intent={Intent.SUCCESS}
                icon={IconNames.LOG_IN}
                text={t("Continue")}
                disabled={!canSubmit}
              />
              {/* pi's flows read a declined prompt as abandoning that step — for OpenRouter it hands the login back
                  to the loopback callback it was racing. So this is the flow's own path, not a dismissal. */}
              <Button icon={IconNames.CROSS} text={t("Skip this step")} onClick={declinePrompt} />
            </ButtonGroup>
          ) : null}
        </form>
      </div>
    </AppDrawer>
  );
}
