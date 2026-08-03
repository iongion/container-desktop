// The shared avatar renderer — one component draws a preset (colored disc + inline glyph), a custom uploaded
// image, or a deterministic monogram, from a worker's avatarId + name. Reused in the Workers list, the Workers
// cards, the worker editor, and Run task cards. The custom library is passed in (not queried per instance)
// so a list of N rows resolves against one shared fetch.
//
// Glyphs are INLINE SVG (not a CSS mask over an external asset): a mask-image URL renders inconsistently across
// the WebKitGTK and WebView2 webviews, and inline paths let the eyes/details pick up the disc colour.

import type { AvatarGlyph } from "@/ai-system/core/avatarPresets";
import { monogramFor, resolveAvatar } from "@/ai-system/core/avatarPresets";
import type { AvatarRecord } from "@/ai-system/core/avatars";

import "./WorkerAvatar.css";

function RobotGlyph({ fg, bg }: { fg: string; bg: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <rect x="45" y="12" width="10" height="14" rx="5" fill={fg} />
      <circle cx="50" cy="11" r="6" fill={fg} />
      <rect x="12" y="46" width="9" height="20" rx="4.5" fill={fg} />
      <rect x="79" y="46" width="9" height="20" rx="4.5" fill={fg} />
      <rect x="22" y="26" width="56" height="50" rx="16" fill={fg} />
      <circle cx="39" cy="50" r="6.5" fill={bg} />
      <circle cx="61" cy="50" r="6.5" fill={bg} />
      <rect x="40" y="63" width="20" height="6" rx="3" fill={bg} />
    </svg>
  );
}

function PersonGlyph({ fg }: { fg: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="35" r="17" fill={fg} />
      <path d="M20 86 C20 64 34 55 50 55 C66 55 80 64 80 86 Z" fill={fg} />
    </svg>
  );
}

function Glyph({ glyph, fg, bg }: { glyph: AvatarGlyph; fg: string; bg: string }) {
  return glyph === "robot" ? <RobotGlyph fg={fg} bg={bg} /> : <PersonGlyph fg={fg} />;
}

export interface WorkerAvatarProps {
  avatarId?: string;
  name: string;
  customs: readonly AvatarRecord[];
  size?: number;
}

export function WorkerAvatar({ avatarId, name, customs, size = 24 }: WorkerAvatarProps) {
  const resolved = resolveAvatar(avatarId, customs, name);
  const style: React.CSSProperties = { width: size, height: size };

  if (resolved.kind === "image") {
    return <img className="WorkerAvatar" style={style} src={resolved.dataUrl} alt={name} title={name} />;
  }

  if (resolved.kind === "preset") {
    const { preset } = resolved;
    return (
      <span
        className="WorkerAvatar WorkerAvatarPreset"
        style={{ ...style, background: preset.bg }}
        role="img"
        aria-label={name}
        title={name}
      >
        <span className="WorkerAvatarGlyph">
          <Glyph glyph={preset.glyph} fg={preset.fg} bg={preset.bg} />
        </span>
      </span>
    );
  }

  const mono = monogramFor(name);
  return (
    <span
      className="WorkerAvatar WorkerAvatarMono"
      style={{ ...style, background: mono.color }}
      role="img"
      aria-label={name}
      title={name}
    >
      <span className="WorkerAvatarInitials" style={{ fontSize: Math.round(size * 0.42) }}>
        {mono.initials}
      </span>
    </span>
  );
}
