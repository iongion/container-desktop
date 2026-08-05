// The native surface for a pi extension's blocking dialog. pi parks the agent until this is answered, so the
// strip sits directly above the composer where the answer is expected — not in an overlay that hides the
// transcript the question is about. Dismissing answers { ok: false }, which resolves the extension's promise
// with pi's documented fallback rather than leaving the agent waiting.
//
// `confirm` renders as an inline Yes / No pair, which is what ConfirmMenu exists to provide: the strip is
// already inline, so wrapping No in a second popover would confirm a confirmation.
import { Button, ButtonGroup, InputGroup, Intent, TextArea } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { PendingUiRequest } from "@/ai-system/core/uiRequests";

import "./ExtensionDialog.css";

export interface ExtensionDialogProps {
  request: PendingUiRequest;
  onRespond: (requestId: string, response: { ok: boolean; value?: unknown }) => Promise<void> | void;
}

export const ExtensionDialog: React.FC<ExtensionDialogProps> = ({ request, onRespond }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(request.prefill ?? "");

  // One slot holds one dialog, and each request arrives as its own object: reseeding on that identity keeps a
  // half-typed answer from surviving into the next question.
  useEffect(() => {
    setDraft(request.prefill ?? "");
  }, [request]);

  const answer = (value: unknown) => void onRespond(request.requestId, { ok: true, value });
  const dismiss = () => void onRespond(request.requestId, { ok: false });

  return (
    <div className="ExtensionDialog">
      <div className="ExtensionDialogHead">
        <span className="ExtensionDialogTitle">{request.title}</span>
        <Button
          className="ExtensionDialogDismiss"
          icon={IconNames.CROSS}
          size="small"
          variant="minimal"
          title={t("Close")}
          aria-label={t("Close")}
          onClick={dismiss}
        />
      </div>
      {request.message ? <div className="ExtensionDialogMessage">{request.message}</div> : null}

      {request.method === "confirm" ? (
        <ButtonGroup className="ExtensionDialogActions">
          <Button
            size="small"
            intent={Intent.PRIMARY}
            icon={IconNames.TICK}
            text={t("Yes")}
            onClick={() => answer(true)}
          />
          <Button size="small" icon={IconNames.CROSS} text={t("No")} onClick={() => answer(false)} />
        </ButtonGroup>
      ) : null}

      {request.method === "select" ? (
        <div className="ExtensionDialogOptions">
          {(request.options ?? []).map((option) => (
            <button key={option} type="button" className="ExtensionDialogOption" onClick={() => answer(option)}>
              {option}
            </button>
          ))}
        </div>
      ) : null}

      {request.method === "input" ? (
        <div className="ExtensionDialogActions">
          <InputGroup
            autoFocus
            fill
            value={draft}
            placeholder={request.placeholder}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") answer(draft);
            }}
          />
          <Button size="small" intent={Intent.PRIMARY} text={t("Send")} onClick={() => answer(draft)} />
        </div>
      ) : null}

      {request.method === "editor" ? (
        <div className="ExtensionDialogEditor">
          <TextArea
            autoFocus
            fill
            className="ExtensionDialogTextArea"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <Button size="small" intent={Intent.PRIMARY} text={t("Save")} onClick={() => answer(draft)} />
        </div>
      ) : null}
    </div>
  );
};
