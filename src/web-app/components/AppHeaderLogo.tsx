import { LOGO_SVG } from "@/web-app/chrome/appChrome";
import "./AppHeaderLogo.css";

// The brand mark lives in appChrome.ts — the SAME markup the static boot splash injects into index.html, so
// the header logo and the pre-React boot logo can never drift. It is trusted, static, in-repo SVG (no user
// input); per-engine + light/dark theming is applied by AppHeaderLogo.css targeting the classes inside it,
// which override the SVG's baked-in `unified`-dark boot defaults. The host span is display:contents so it
// does not change the flex layout of `.App-companyLogoBrand` (the SVG stays the effective child).
export function AppHeaderLogo() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted static in-repo SVG asset, no user input
  return <span className="AppHeaderLogoHost" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />;
}
