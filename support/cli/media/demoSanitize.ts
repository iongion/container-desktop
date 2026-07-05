// Pure sanitizers for the rrweb demo recordings (support/demoReplay.mjs).
//
// The recordings are DOM+CSS snapshots replayed inside an rrweb <iframe> on container-desktop.com. That
// iframe is self-contained: it can't reach the dev server the app was recorded against, nor inherit the
// site's own webfonts (an iframe has its own font registry). So every local dev-server reference has to be
// rewritten to be portable — local assets (images AND fonts) inlined as data: URLs, and the localhost origin
// swapped for the public one. Kept dependency-free (node:fs / node:path only) so it unit-tests hermetically
// without pulling the playwright/electron orchestration in demoReplay.mjs.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_HOME } from "@/cli/lib/paths";

const ROOT = PROJECT_HOME;

const assetDataUrlCache = new Map();
export const TRANSPARENT_PIXEL_URL = 'url("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")';
export const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

// The "Container Desktop" wordmark is painted with an SVG gradient referenced as `fill: url(#AppHeaderLogoGrad)`
// — both as an inline attribute and as a CSS rule. Neither survives the rrweb replay <iframe>: the inline
// fragment paint resolves empty (the gradient's stops read stop-color from CSS custom properties that don't
// cascade into the isolated iframe), and rrweb's snapshot ABSOLUTIZES the CSS `url(#…)` against the dev origin
// (`url("http://localhost:3000/…#AppHeaderLogoGrad")`), which the local-asset rules below would otherwise turn
// into the transparent-pixel placeholder. Either way the wordmark vanishes while the solid-fill tagline stays.
// Run first and flatten EVERY form (bare fragment or absolutized) to a solid near-white that reads on the dark
// titlebar in each engine recording — the gradient is barely perceptible at the titlebar's scale.
export const WORDMARK_REPLAY_FILL = "#eaf2f0";
const WORDMARK_GRADIENT_FILL_RE = /url\((["']?)[^)]*#AppHeaderLogoGrad\1\)/g;

// Fonts count as embeddable so the app's bundled webfaces (Montserrat wordmark/tagline, JetBrains Mono)
// inline into the recording — the rrweb replay iframe has its own font registry and can't reach the dev
// server or inherit the host page's fonts, so an un-inlined @font-face src would leave the logo on Arial.
export function isEmbeddableAssetPathname(pathname) {
  return /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot)$/i.test(pathname);
}

const FONT_MIME_TYPES = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
};

export function mimeTypeForPathname(pathname) {
  const extension = pathname.toLowerCase().split(".").pop();
  if (extension === "svg") {
    return "image/svg+xml";
  }
  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }
  if (extension === "ico") {
    return "image/x-icon";
  }
  if (FONT_MIME_TYPES[extension]) {
    return FONT_MIME_TYPES[extension];
  }
  return `image/${extension}`;
}

export function localAssetPathname(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const url = new URL(value);
    if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port === "3000") {
      return decodeURIComponent(url.pathname);
    }
  } catch {
    if (value.startsWith("/")) {
      return decodeURIComponent(value.split(/[?#]/, 1)[0]);
    }
  }
  return undefined;
}

export function dataUrlForLocalAsset(value) {
  const pathname = localAssetPathname(value);
  if (!pathname || !isEmbeddableAssetPathname(pathname)) {
    return undefined;
  }
  if (assetDataUrlCache.has(pathname)) {
    return assetDataUrlCache.get(pathname);
  }
  const filePath = path.join(ROOT, pathname.slice(1));
  if (!existsSync(filePath)) {
    return undefined;
  }
  const dataUrl = `data:${mimeTypeForPathname(pathname)};base64,${readFileSync(filePath).toString("base64")}`;
  assetDataUrlCache.set(pathname, dataUrl);
  return dataUrl;
}

export function sanitizeLocalDevReferences(value) {
  if (typeof value !== "string") {
    return value;
  }
  // NB: @font-face rules are intentionally KEPT — the url() rewrites below inline their woff2 src as a data
  // URL, so the fonts ship inside the replay. (They used to be stripped, which dropped the logo's Montserrat.)
  return (
    value
      // Flatten the wordmark's broken gradient paint to a solid color so the logo text stays visible (see above).
      .replace(WORDMARK_GRADIENT_FILL_RE, WORDMARK_REPLAY_FILL)
      .replace(/url\((["']?)(https?:\/\/(?:localhost|127\.0\.0\.1):3000[^)"']+)\1\)/g, (_match, _quote, url) => {
        return `url("${dataUrlForLocalAsset(url) || TRANSPARENT_PIXEL}")`;
      })
      .replace(/url\((["']?)(\/(?:src|support)[^)"']+)\1\)/g, (_match, _quote, url) => {
        return `url("${dataUrlForLocalAsset(url) || TRANSPARENT_PIXEL}")`;
      })
      .replace(/url\((["']?)data:,\1\)/g, TRANSPARENT_PIXEL_URL)
      .replace(/https?:\/\/(?:localhost|127\.0\.0\.1):3000\/(?:src|support)[^"'\s)]+/g, (url) => {
        return dataUrlForLocalAsset(url) || url;
      })
      .replace(/https?:\/\/(?:localhost|127\.0\.0\.1):3000(?=\/|$)/g, "https://container-desktop.com")
  );
}
