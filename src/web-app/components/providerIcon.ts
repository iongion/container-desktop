// Provider → Blueprint icon — the ONE presentation map shared by the ModelPicker (composer) and the
// AISettingsForm (settings), so the two surfaces stay visually identical. Presentation-only: it lives in
// the renderer, never in core (engine SVGs stay engine-only per the project's icon convention; AI
// providers reuse Blueprint's stock icons). Local servers get a device/cube glyph, clouds the cloud glyph.
import { type IconName, IconNames } from "@blueprintjs/icons";

const PROVIDER_ICONS: Record<string, IconName> = {
  lmstudio: IconNames.DESKTOP,
  llamacpp: IconNames.CUBE,
  anthropic: IconNames.CLOUD,
  openai: IconNames.CLOUD,
  deepseek: IconNames.CLOUD,
  glm: IconNames.CLOUD,
  minimax: IconNames.CLOUD,
  openrouter: IconNames.CLOUD,
};

export function providerIcon(id: string): IconName {
  return PROVIDER_ICONS[id] ?? IconNames.CUBE;
}
