// Eleventy config for the iongion.github.io/container-desktop website.
// Sources live in website-src/ and compile into website/ (committed + published
// to GitHub Pages). Keep this minimal — markdown content + Nunjucks layouts,
// near-zero client JS, build-time version injection from package.json.
import { createRequire } from "node:module";
import { HtmlBasePlugin } from "@11ty/eleventy";

const { homepage } = createRequire(import.meta.url)("./support/app-metadata.cjs");

export default function (eleventyConfig) {
  // The site is served under the homepage's path (GitHub Pages: /container-desktop/): prefixes every root-relative
  // href/src in the HTML output; anything else (data-* attributes, meta content) goes through `htmlBaseUrl`.
  eleventyConfig.addPlugin(HtmlBasePlugin);

  // Static assets copied verbatim to the published site root and /assets.
  // (favicons, webmanifest, browserconfig, img/, videos/ -> site root)
  eleventyConfig.addPassthroughCopy({ "website-src/static": "." });
  eleventyConfig.addPassthroughCopy({ "website-src/assets": "assets" });

  // The OS setup guides, authored as markdown in website-src/manual/*.md.
  // Ordered by their `order` front-matter so the Manual sidebar is stable.
  eleventyConfig.addCollection("guides", (api) =>
    api.getFilteredByGlob("website-src/manual/*.md").sort((a, b) => (a.data.order || 0) - (b.data.order || 0)),
  );

  return {
    dir: { input: "website-src", output: "website", includes: "_includes", data: "_data" },
    pathPrefix: `${new URL(homepage).pathname.replace(/\/$/, "")}/`,
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["njk", "md", "html"],
  };
}
