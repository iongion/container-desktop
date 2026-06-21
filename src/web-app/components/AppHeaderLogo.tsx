import "./AppHeaderLogo.css";

// Stacked-layers mark (converging: bottom plate widest → narrowing to one on top = "many engines,
// one platform"), drawn in a 256-box and placed left of the wordmark. Each plate is a rounded
// isometric diamond — the rounding comes from a same-colored stroke (see AppHeaderLogo.css).
const PLATE_DEEP = "M128,120 L216,152 L128,184 L40,152 Z";
const PLATE_ACCENT = "M128,94 L198,120 L128,146 L58,120 Z";
const PLATE_BRIGHT = "M128,72 L180,92 L128,112 L76,92 Z";

const TAGLINES = [
  { engine: "unified", label: "Containers desktop companion" },
  { engine: "podman", label: "Podman desktop companion" },
  { engine: "docker", label: "Docker desktop companion" },
] as const;

export function AppHeaderLogo() {
  return (
    <svg
      aria-label="Container Desktop"
      className="AppHeaderLogo"
      focusable="false"
      role="img"
      viewBox="0 0 940 200"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Container Desktop</title>
      <defs>
        {/* Wordmark gradient — mirrors the website `.grad`: white → grad-1 → grad-2, re-skinned
            per engine (and inverted for light mode) via the stop colors in AppHeaderLogo.css. */}
        <linearGradient id="AppHeaderLogoGrad" x1="0" x2="1" y1="0" y2="0.3">
          <stop className="AppHeaderLogoGradStop0" offset="0.18" />
          <stop className="AppHeaderLogoGradStop1" offset="0.52" />
          <stop className="AppHeaderLogoGradStop2" offset="0.92" />
        </linearGradient>
      </defs>
      <g className="AppHeaderLogoMark" transform="translate(6,28) scale(0.56)">
        <path className="AppHeaderLogoPlate AppHeaderLogoPlate--deep" d={PLATE_DEEP} />
        <path className="AppHeaderLogoPlate AppHeaderLogoPlate--accent" d={PLATE_ACCENT} />
        <path className="AppHeaderLogoPlate AppHeaderLogoPlate--bright" d={PLATE_BRIGHT} />
      </g>
      <text className="AppHeaderLogoTitle" x="178" y="96">
        Container Desktop
      </text>
      {TAGLINES.map((tagline) => (
        <text
          aria-label={tagline.label}
          className={`AppHeaderLogoTagline AppHeaderLogoTagline--${tagline.engine}`}
          key={tagline.engine}
          x="180"
          y="137"
        >
          {tagline.label}
        </text>
      ))}
    </svg>
  );
}
