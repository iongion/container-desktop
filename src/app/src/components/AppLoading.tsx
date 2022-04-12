import { Intent, ProgressBar } from "@blueprintjs/core";
// project
import { useStoreState } from "../domain/types";
// module
import "./AppLoading.css";

export interface AppLoadingProps {}

export const AppLoading: React.FC<AppLoadingProps> = () => {
  const pending = useStoreState((state) => state.pending);
  const splashContent = pending ? <ProgressBar intent={Intent.PRIMARY} /> : null;
  return (
    <div className="AppLoading">
      <div className="AppLoadingSplashContainer">
        <div className="AppLoadingSplashLogo"></div>
        <div className="AppLoadingSplashContent">
          {splashContent}
        </div>
      </div>
    </div>
  );
};
