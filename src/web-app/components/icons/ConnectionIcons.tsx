// Custom monochrome connection-state/action icons. Inline SVGs inherit the host button's color (styleable,
// theme-aware) and stay crisp at 16px. The universal "link" metaphor: a solid joined link = connected; the bar
// broken with a gap = disconnected.

export interface ConnectionIconProps {
  size?: number;
  className?: string;
}

const COMMON = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  // `display: block` kills the inline-SVG baseline descender gap (otherwise the glyph sits high and leaves
  // stray space below it inside buttons). Keeps every connect/disconnect button tightly sized + centered.
  style: { display: "block" },
};

const SOLID_COMMON = {
  viewBox: "0 0 24 24",
  fill: "currentColor",
  style: { display: "block" },
};

// Connected: same chain silhouette as ConnectIcon, but filled solid so the success-colored state reads as whole.
export function ConnectedIcon({ size = 16, className }: ConnectionIconProps) {
  return (
    <svg className={className} width={size} height={size} aria-hidden="true" focusable="false" {...SOLID_COMMON}>
      <path d="M7 6h4.25v4H7a2 2 0 0 0 0 4h4.25v4H7A6 6 0 1 1 7 6Z" />
      <path d="M12.75 6H17a6 6 0 1 1 0 12h-4.25v-4H17a2 2 0 1 0 0-4h-4.25V6Z" />
      <path d="M8 10.25h8v3.5H8z" />
    </svg>
  );
}

// Connected: a whole chain link — two hooks joined by an unbroken middle bar.
export function ConnectIcon({ size = 16, className }: ConnectionIconProps) {
  return (
    <svg className={className} width={size} height={size} aria-hidden="true" focusable="false" {...COMMON}>
      <path d="M9 7H7a5 5 0 0 0 0 10h2" />
      <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
      <path d="M8 12h8" />
    </svg>
  );
}

// Disconnected: a broken chain link — the two hooks remain but the middle bar is snapped (gap).
export function DisconnectIcon({ size = 16, className }: ConnectionIconProps) {
  return (
    <svg className={className} width={size} height={size} aria-hidden="true" focusable="false" {...COMMON}>
      <path d="M9 7H7a5 5 0 0 0 0 10h2" />
      <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
      <path d="M8 12h2" />
      <path d="M14 12h2" />
    </svg>
  );
}
