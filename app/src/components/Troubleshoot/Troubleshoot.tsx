import { useCallback, useState } from "react";
import { AnchorButton, HTMLTable, Button, Intent, H6, ButtonProps, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { AppScreen } from "../../Types";
import { useStoreActions } from "../../Domain";
import { Notification } from "../../Notification";

import "./Troubleshoot.css";
import { useTimeout } from "usehooks-ts";

interface ScreenProps {}

export const ID = "troubleshoot";
export const Title = "Troubleshoot";

interface ConfirmButtonProps extends ButtonProps {
  onConfirm?: (event: React.MouseEvent<HTMLElement, MouseEvent>) => void;
  onCancel?: (event: React.MouseEvent<HTMLElement, MouseEvent>) => void;
}

export const TimeoutButton: React.FC<ButtonProps> = (props) => {
  const [countDownDisabled, setCountdownDisabled] = useState(true);
  useTimeout(() => {
    setCountdownDisabled(false);
  }, 700);
  return <Button {...props} disabled={props.disabled || countDownDisabled} />;
};

export const ConfirmButton: React.FC<ConfirmButtonProps> = ({ onConfirm, onCancel, ...props }) => {
  const { t } = useTranslation();
  const [withConfirm, setWithConfirm] = useState(false);
  const onConfirmRequest = useCallback((e) => {
    setWithConfirm(true);
  }, []);
  const onConfirmResponse = useCallback(
    (e) => {
      setWithConfirm(false);
      const request = e.currentTarget.getAttribute("data-request");
      if (request === "confirm.accept") {
        if (onConfirm) {
          onConfirm(e);
        }
      } else if (request === "confirm.reject") {
        if (onCancel) {
          onCancel(e);
        }
      }
    },
    [onConfirm, onCancel]
  );
  const action: string = (props as any)["data-action"];
  return withConfirm ? (
    <ButtonGroup fill className="ActionButtonGroup">
      <TimeoutButton
        className="ActionButtonInternal"
        fill
        data-action={action}
        disabled={props.disabled}
        onClick={onConfirmResponse}
        intent={Intent.DANGER}
        data-request="confirm.accept"
        text={t("Confirm")}
        icon={IconNames.TICK_CIRCLE}
      />
      <Button
        className="ActionButtonInternal"
        fill
        data-action={action}
        disabled={props.disabled}
        onClick={onConfirmResponse}
        intent={Intent.SUCCESS}
        data-request="confirm.reject"
        text={t("Cancel")}
        icon={IconNames.DELETE}
      />
    </ButtonGroup>
  ) : (
    <Button {...props} onClick={onConfirmRequest} />
  );
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const troubleShootPrune = useStoreActions((store) => store.troubleShootPrune);
  const troubleShootReset = useStoreActions((store) => store.troubleShootReset);
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const Actions = [
    {
      name: "troubleshoot.support.podman",
      text: t("Access online help"),
      title: t("Podman"),
      description: t("Get help with podman"),
      href: "https://podman.io/getting-started",
      icon: IconNames.HELP
    },
    {
      name: "troubleshoot.support.podman-composer",
      text: t("Access online help"),
      title: t("Podman composer"),
      description: t("Get help with podman composer"),
      href: "https://github.com/containers/podman-compose",
      icon: IconNames.HELP
    },
    {
      name: "troubleshoot.prune",
      text: t("Clean / Prune data"),
      title: t("Clean / Prune data"),
      description: t("Clean-up the system"),
      intent: Intent.WARNING,
      icon: IconNames.TRASH,
      confirm: true
    },
    {
      name: "troubleshoot.reset",
      text: t("Factory reset"),
      title: t("Factory reset"),
      description: t("Reset to factory settings"),
      intent: Intent.WARNING,
      icon: IconNames.RESET,
      confirm: true
    }
  ];
  const onActionClick = useCallback(
    async (e) => {
      const sender = e.currentTarget;
      const action = sender.getAttribute("data-action");
      let result = { success: false, message: `No action handler for ${action}` };
      setDisabledAction(action);
      try {
        switch (action) {
          case "troubleshoot.prune":
            result = await troubleShootPrune();
            break;
          case "troubleshoot.reset":
            result = await troubleShootReset();
            break;
          default:
            break;
        }
        console.debug("Command execution completed", result);
        Notification.show({ message: t("Command completed"), intent: Intent.SUCCESS });
      } catch (error: any) {
        console.error("Command execution failed", error.message);
        Notification.show({
          message: t("Command did not execute properly - {{message}} {{data}}", {
            message: error.message,
            data: error.data
          }),
          intent: Intent.DANGER
        });
      }
      setDisabledAction(undefined);
    },
    [troubleShootPrune, troubleShootReset, t]
  );
  return (
    <div className="AppScreen" data-screen={ID}>
      <div className="AppScreenContent">
        <HTMLTable condensed striped data-table="troubleshoot.actions">
          <tbody>
            {Actions.map((action) => {
              return (
                <tr key={action.name}>
                  <td key={action.name}>
                    <H6>{action.title}</H6>
                    <p>{action.description}</p>
                  </td>
                  <td>
                    {action.href ? (
                      <AnchorButton
                        disabled={action.name === disabledAction}
                        className="ActionButton"
                        fill
                        minimal
                        intent={action.intent || Intent.PRIMARY}
                        text={action.text}
                        href={action.href}
                        target="_blank"
                        icon={action.icon as any}
                      />
                    ) : action.confirm ? (
                      <ConfirmButton
                        disabled={action.name === disabledAction}
                        className="ActionButton"
                        fill
                        intent={action.intent || Intent.PRIMARY}
                        text={action.text}
                        data-action={action.name}
                        onConfirm={onActionClick}
                        icon={action.icon as any}
                      />
                    ) : (
                      <Button
                        disabled={action.name === disabledAction}
                        className="ActionButton"
                        fill
                        intent={action.intent || Intent.PRIMARY}
                        text={action.text}
                        data-action={action.name}
                        onClick={onActionClick}
                        icon={action.icon as any}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </HTMLTable>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/${ID}`
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
  ExcludeFromSidebar: true
};
