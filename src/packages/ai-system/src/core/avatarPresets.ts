// Avatar presets + resolution. Pure and node-free: preset DATA and the id→appearance mapping only. Rendering
// (glyph SVGs, DOM) lives in @/web-app/components/ai/WorkerAvatar. Colors are a FIXED vivid palette, independent
// of the engine theme, so an avatar looks the same on every engine (like the standalone engine-accent dots).

export type AvatarGlyph = "robot" | "person";

export interface AvatarPreset {
  id: string;
  glyph: AvatarGlyph;
  bg: string;
  fg: string;
  label: string;
}

// bg = disc fill, fg = masked-glyph color. Kept high-contrast so the silhouette reads at 20px.
export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  { id: "robot-teal", glyph: "robot", bg: "#14303a", fg: "#2dd4bf", label: "Bot Teal" },
  { id: "robot-amber", glyph: "robot", bg: "#3a2a12", fg: "#f59e0b", label: "Bot Amber" },
  { id: "robot-blue", glyph: "robot", bg: "#1c3350", fg: "#60a5fa", label: "Bot Blue" },
  { id: "robot-pink", glyph: "robot", bg: "#3a1330", fg: "#f472b6", label: "Bot Pink" },
  { id: "robot-lime", glyph: "robot", bg: "#202a1a", fg: "#a3e635", label: "Bot Lime" },
  { id: "person-violet", glyph: "person", bg: "#3a2350", fg: "#a855c9", label: "Person Violet" },
  { id: "person-mint", glyph: "person", bg: "#14303a", fg: "#34d399", label: "Person Mint" },
  { id: "person-blue", glyph: "person", bg: "#22314a", fg: "#60a5fa", label: "Person Blue" },
  { id: "person-red", glyph: "person", bg: "#3a2020", fg: "#f87171", label: "Person Red" },
  { id: "person-slate", glyph: "person", bg: "#26303a", fg: "#cbd5e1", label: "Person Slate" },
] as const;

export const AVATAR_MONOGRAM_PALETTE: readonly string[] = [
  "#14b8a6",
  "#a855c9",
  "#f59e0b",
  "#60a5fa",
  "#34d399",
  "#f472b6",
  "#f87171",
  "#a3e635",
];

export type ResolvedAvatar =
  | { kind: "preset"; preset: AvatarPreset }
  | { kind: "image"; dataUrl: string }
  | { kind: "monogram"; color: string };

function hash(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(value);
}

export function monogramFor(name: string): { initials: string; color: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length === 0
      ? "?"
      : words.length === 1
        ? words[0].slice(0, 2).toUpperCase()
        : (words[0][0] + words[words.length - 1][0]).toUpperCase();
  const color = AVATAR_MONOGRAM_PALETTE[hash(name.trim() || "?") % AVATAR_MONOGRAM_PALETTE.length];
  return { initials, color };
}

const PRESETS_BY_ID = new Map(AVATAR_PRESETS.map((preset) => [preset.id, preset]));

export function resolveAvatar(
  avatarId: string | undefined,
  customs: readonly { id: string; dataUrl: string }[],
  seed: string,
): ResolvedAvatar {
  if (avatarId) {
    const preset = PRESETS_BY_ID.get(avatarId);
    if (preset) return { kind: "preset", preset };
    const custom = customs.find((entry) => entry.id === avatarId);
    if (custom) return { kind: "image", dataUrl: custom.dataUrl };
  }
  return { kind: "monogram", color: monogramFor(seed).color };
}
