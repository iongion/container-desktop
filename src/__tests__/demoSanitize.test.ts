import { describe, expect, it } from "vitest";
import {
  dataUrlForLocalAsset,
  isEmbeddableAssetPathname,
  mimeTypeForPathname,
  sanitizeLocalDevReferences,
  WORDMARK_REPLAY_FILL,
} from "../../support/demoSanitize.mjs";

// The demo replays render inside a self-contained rrweb <iframe> on the site, so the app's bundled webfonts
// (Montserrat wordmark/tagline, JetBrains Mono) must travel INSIDE the recording as inlined @font-face data
// URLs — otherwise the logo falls back to Arial/Helvetica. This is a real bundled font served by Vite dev.
const FONT_URL = "http://localhost:3000/src/web-app/themes/fonts/Montserrat-500.woff2";

describe("demo recording sanitizer — fonts travel with the replay", () => {
  it("treats web font files as embeddable assets", () => {
    expect(isEmbeddableAssetPathname("/src/web-app/themes/fonts/Montserrat-500.woff2")).toBe(true);
    expect(isEmbeddableAssetPathname("/x.woff")).toBe(true);
    expect(isEmbeddableAssetPathname("/x.ttf")).toBe(true);
    expect(isEmbeddableAssetPathname("/x.otf")).toBe(true);
    // still rejects non-assets
    expect(isEmbeddableAssetPathname("/x.js")).toBe(false);
  });

  it("maps font extensions to font MIME types without regressing images", () => {
    expect(mimeTypeForPathname("Montserrat-500.woff2")).toBe("font/woff2");
    expect(mimeTypeForPathname("x.woff")).toBe("font/woff");
    expect(mimeTypeForPathname("x.ttf")).toBe("font/ttf");
    expect(mimeTypeForPathname("x.otf")).toBe("font/otf");
    expect(mimeTypeForPathname("x.png")).toBe("image/png");
    expect(mimeTypeForPathname("x.svg")).toBe("image/svg+xml");
  });

  it("inlines the bundled woff2 as a font data URL", () => {
    expect(dataUrlForLocalAsset(FONT_URL)).toMatch(/^data:font\/woff2;base64,[A-Za-z0-9+/]+=*$/);
  });

  it("keeps @font-face rules and inlines their src so the logo font survives playback", () => {
    const css = `@font-face { font-family: "Montserrat"; font-weight: 500; font-display: swap; src: url("${FONT_URL}") format("woff2"); }`;
    const out = sanitizeLocalDevReferences(css);
    // the rule is preserved (previously it was stripped wholesale, leaving font-family: Montserrat undefined)
    expect(out).toContain("@font-face");
    expect(out).toContain('font-family: "Montserrat"');
    // the src is a portable font data URL — not a dev-server URL and not the transparent-GIF placeholder
    expect(out).toContain("data:font/woff2;base64,");
    expect(out).not.toContain("localhost:3000");
    expect(out).not.toContain("data:image/gif");
  });

  it("flattens the wordmark gradient fill so the logo text renders in the replay iframe", () => {
    // The "Container Desktop" wordmark is painted with fill: url(#AppHeaderLogoGrad); the gradient's
    // stop-colors come from CSS custom properties that don't cascade into rrweb's isolated iframe, so the
    // fragment paint resolves empty and the wordmark disappears (while the solid-fill tagline stays).
    // The bare inline SVG attribute form must become a solid color:
    expect(sanitizeLocalDevReferences("url(#AppHeaderLogoGrad)")).toBe(WORDMARK_REPLAY_FILL);
    const css = ".AppHeaderLogoTitle { fill: url(#AppHeaderLogoGrad); }";
    expect(sanitizeLocalDevReferences(css)).toBe(`.AppHeaderLogoTitle { fill: ${WORDMARK_REPLAY_FILL}; }`);
    // rrweb ABSOLUTIZES the CSS url() against the dev origin; that form must be caught HERE (first) so the
    // local-asset rules don't first degrade it to the transparent-pixel placeholder (which then wins over
    // the inline attribute via CSS specificity, re-hiding the wordmark).
    const abs = '.AppHeaderLogoTitle { fill: url("http://localhost:3000/manual/#AppHeaderLogoGrad"); }';
    expect(sanitizeLocalDevReferences(abs)).toBe(`.AppHeaderLogoTitle { fill: ${WORDMARK_REPLAY_FILL}; }`);
    expect(sanitizeLocalDevReferences(abs)).not.toContain("data:image/gif");
    expect(sanitizeLocalDevReferences(abs)).not.toContain("url(");
  });

  it("still inlines images and rewrites the dev origin (no regression)", () => {
    const rewritten = sanitizeLocalDevReferences(
      'a { background: url("http://localhost:3000/src/web-app/images/podman.svg"); }',
    );
    expect(rewritten).toContain("data:image/svg+xml;base64,");
    expect(sanitizeLocalDevReferences("http://localhost:3000/manual/")).toBe("https://container-desktop.com/manual/");
  });
});
