import { Intent, ProgressBar } from "@blueprintjs/core";
import dayjs from "dayjs";
import { useEffect, useRef } from "react";
// project
import i18n from "@/web-app/App.i18n";
import { useStoreState } from "@/web-app/domain/types";
// module
import "./AppLoading.css";

export interface AppLoadingProps {}

export const AppLoading: React.FC<AppLoadingProps> = () => {
  const pending = useStoreState((state) => state.pending);
  const systemNotifications = useStoreState((state) => state.systemNotifications);
  const phasesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    phasesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [systemNotifications]);
  return (
    <div className="AppLoading" data-pending={pending ? "yes" : "no"}>
      <div className="AppLoadingSplashContainer">
        <div className="AppLoadingSplashLogo"></div>
        <div className="AppLoadingSplashContent">
          {pending ? (
            <>
              <ProgressBar intent={Intent.PRIMARY} />
              {systemNotifications.length ? (
                <div className="AppLoadingSplashPhases">
                  {systemNotifications.map((it) => {
                    return (
                      <div className="AppLoadingSplashPhase" key={it.guid}>
                        <span>{dayjs(it.date).format("HH:mm:ss.SSS")}</span>
                        <p>{it.data?.trace ? i18n.t(it.data?.trace) : "..."}</p>
                      </div>
                    );
                  })}
                  <div ref={phasesRef} />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
