import { Button, Callout, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiEmoticonSad } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import React from "react";
import i18n from "@/i18n";
import { createLogger } from "@/logger";
import { CopyButton } from "@/web-app/components/CopyButton";

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
    // The error itself is kept, not just the fact that there was one. A screen that says "an uncaught error showed
    // up" and then withholds which one sends the reader to a log file to learn what the app already knew.
    return { hasError: true, error };
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
    this.setState({ componentStack: errorInfo?.componentStack });
  }

  // Everything worth pasting into a report, in one string: what failed, where it threw, and which component was
  // rendering. The reader should never have to go and find the log to answer "what actually broke".
  report(): string {
    const error = this.state.error;
    return [
      String(error?.message ?? error ?? i18n.t("Unknown error")),
      error?.stack ? `\n${error.stack}` : "",
      this.state.componentStack ? `\n${this.state.componentStack}` : "",
    ]
      .join("")
      .trim();
  }

  render(): any {
    if (this.state.hasError) {
      // Full-window opaque fallback: covers the entire app (header, sidebar, content, console) so a crash
      // never renders alongside live chrome. Both buttons hard-reload to reboot on a known-good screen.
      return (
        <div className="AppErrorBoundaryOverlay">
          <div className="AppErrorBoundary">
            <Callout
              className="AppErrorBoundaryCallout"
              title={this.props.title}
              icon={<ReactIcon.Icon path={mdiEmoticonSad} size={5} />}
            >
              <h3>{this.props.message}</h3>
              {/* The actual failure, verbatim and selectable. This is the first thing the reader needs and it used
                  to be the one thing this screen withheld. */}
              <div className="AppErrorBoundaryReason">
                <code>{String(this.state.error?.message ?? this.state.error ?? i18n.t("Unknown error"))}</code>
                <CopyButton text={this.report()} title={i18n.t("Copy the error details")} />
              </div>
              {this.report().includes("\n") ? (
                <details className="AppErrorBoundaryDetails">
                  <summary>{i18n.t("Show details")}</summary>
                  <pre>{this.report()}</pre>
                </details>
              ) : null}
              <p>{this.props.suggestion}</p>
              <div className="AppErrorBoundaryDashboard">
                <Button
                  variant="minimal"
                  icon={IconNames.DASHBOARD}
                  onClick={this.onGoToDashboardClick}
                  text={this.props.dashboard ?? i18n.t("Go to Dashboard")}
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
      );
    }

    return this.props.children;
  }
}
