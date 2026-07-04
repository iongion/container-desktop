import { Button, Callout, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiEmoticonSad } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import React from "react";
import { createLogger } from "@/platform/logger";

const logger = createLogger("web.AppErrorBoundary");

export default class AppErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    onReconnect: any;
    title?: string;
    message?: string;
    suggestion?: string;
    reconnect?: string;
    dashboard?: string;
  },
  any
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  onReconnectClick = () => {
    // Raw, full window reload — deliberately NOT a code-driven re-bootstrap (which can carry the bad
    // state forward). The hash router keeps the current route in window.location, so reloading reboots
    // the app and restores the very screen that failed.
    window.location.reload();
  };

  onGoToDashboardClick = (event: React.MouseEvent) => {
    event.preventDefault();
    // Escape the failed screen: point the hash router at the dashboard (root route), then hard-reload so the
    // app reboots on a known-good screen instead of re-mounting the one that just crashed.
    window.location.hash = "#/";
    window.location.reload();
  };

  componentDidCatch(error: any, errorInfo: any) {
    logger.error("UI application error", error.message, error.stack, errorInfo);
  }

  render(): any {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div className="AppContent">
          <div className="AppContentDocument" data-error="yes">
            <div className="AppScreen" data-pending="yes">
              <div className="AppErrorBoundary">
                <Callout
                  className="AppErrorBoundaryCallout"
                  title={this.props.title}
                  icon={<ReactIcon.Icon path={mdiEmoticonSad} size={5} />}
                >
                  <h3>{this.props.message}</h3>
                  <p>{this.props.suggestion}</p>
                  <div className="AppErrorBoundaryDashboard">
                    <Button
                      variant="minimal"
                      icon={IconNames.DASHBOARD}
                      onClick={this.onGoToDashboardClick}
                      text={this.props.dashboard ?? "Go to Dashboard"}
                    />
                  </div>
                  <Button
                    onClick={this.onReconnectClick}
                    icon={IconNames.RESOLVE}
                    text={this.props.reconnect}
                    intent={Intent.PRIMARY}
                  />
                </Callout>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
