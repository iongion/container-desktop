import { AISettingsForm } from "./AISettingsForm";
import { AppearancePanel } from "./panels/AppearancePanel";
import { ConfigPanel } from "./panels/ConfigPanel";
import { LoggingPanel } from "./panels/LoggingPanel";
import { NetworkPanel } from "./panels/NetworkPanel";
import { StartupPanel } from "./panels/StartupPanel";

// Maps each pure category id (see settingsCategoryModel) to the React panel that renders it. Kept apart
// from the pure model so that model stays framework-free and unit-testable; this file is the React seam.
export const SETTINGS_PANELS: Record<string, React.FC> = {
  appearance: AppearancePanel,
  startup: StartupPanel,
  network: NetworkPanel,
  ai: AISettingsForm,
  config: ConfigPanel,
  logging: LoggingPanel,
};
