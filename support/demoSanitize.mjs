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
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const assetDataUrlCache = new Map();
export const TRANSPARENT_PIXEL_URL = 'url("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")';
export const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

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
  return value
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
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1):3000(?=\/|$)/g, "https://container-desktop.com");
}
